package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"golang.org/x/sync/errgroup"
)

const (
	isDebug        = true
	defaultMapSize = 8
)

var d *Describer

type Describer struct {
	ctx     context.Context
	client  *ec2.Client
	regions []string
}

func init() {
	d = &Describer{
		ctx: context.Background(),
	}
	cfg, err := config.LoadDefaultConfig(
		d.ctx,
		config.WithRetryMode(aws.RetryModeStandard),
		config.WithRetryMaxAttempts(10),
	)
	if err != nil {
		log.Fatal(err)
	}
	d.client = ec2.NewFromConfig(cfg)
	out, err := d.client.DescribeRegions(d.ctx, &ec2.DescribeRegionsInput{})
	if err != nil {
		log.Fatal(err)
	}
	d.regions = make([]string, len(out.Regions))
	for i, region := range out.Regions {
		d.regions[i] = aws.ToString(region.RegionName)
	}
}

type CountInfo struct {
	Region           string `json:"region"`
	TotalInstances   int    `json:"totalInstances"`
	RunningInstances int    `json:"runningInstances"`
}

type InstanceInfo struct {
	Region       string                  `json:"region"`
	InstanceID   string                  `json:"instanceId"`
	InstanceName string                  `json:"instanceName"`
	State        types.InstanceStateName `json:"state"`
}

type PermissionInfo struct {
	IpProtocol string `json:"ipProtocol"`
	FromPort   int32  `json:"fromPort"`
	ToPort     int32  `json:"toPort"`
	AllowFrom  string `json:"allowFrom"`
}

type InstanceSecurityGroupInfo struct {
	Region       string                  `json:"region"`
	InstanceID   string                  `json:"instanceId"`
	InstanceName string                  `json:"instanceName"`
	State        types.InstanceStateName `json:"state"`
	Permissions  []PermissionInfo        `json:"permissions"`
}

type EventRequest struct {
	ActionGroup string `json:"actionGroup"`
	APIPath     string `json:"apiPath"`
	HTTPMethod  string `json:"httpMethod"`
	Parameters  []struct {
		Name  string `json:"name"`
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"parameters"`
	ResponseBody map[string]map[string]any `json:"responseBody"`
}

type EventResponse struct {
	MessageVersion string   `json:"messageVersion"`
	Response       Response `json:"response"`
}

type Response struct {
	ActionGroup    string                    `json:"actionGroup"`
	APIPath        string                    `json:"apiPath"`
	HTTPMethod     string                    `json:"httpMethod"`
	HTTPStatusCode int                       `json:"httpStatusCode"`
	ResponseBody   map[string]map[string]any `json:"responseBody"`
}

func getRegionNames(event EventRequest) []string {
	for _, parameter := range event.Parameters {
		if parameter.Name == "regions" && parameter.Value != "all" {
			return strings.Split(parameter.Value, ",")
		}
	}
	return d.regions
}

func getInstanceTagValue(key string, tags []types.Tag) string {
	for _, t := range tags {
		if t.Key != nil && strings.EqualFold(aws.ToString(t.Key), key) && t.Value != nil {
			return aws.ToString(t.Value)
		}
	}
	return ""
}

func GetInstancesCount(regions []string) ([]CountInfo, error) {
	var mu sync.Mutex
	var infos []CountInfo
	eg, ctx := errgroup.WithContext(d.ctx)
	for _, region := range regions {
		region := region
		eg.Go(func() error {
			total := 0
			running := 0
			var token *string
			for {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
				out, err := d.client.DescribeInstances(
					ctx,
					&ec2.DescribeInstancesInput{
						NextToken: token,
					},
					func(o *ec2.Options) {
						o.Region = region
					},
				)
				if err != nil {
					return fmt.Errorf("%s: %w", region, err)
				}
				for _, r := range out.Reservations {
					total += len(r.Instances)
					for _, i := range r.Instances {
						if i.State.Name == types.InstanceStateNameRunning {
							running++
						}
					}
				}
				token = out.NextToken
				if token == nil {
					break
				}
			}
			info := CountInfo{
				Region:           region,
				TotalInstances:   total,
				RunningInstances: running,
			}
			mu.Lock()
			infos = append(infos, info)
			mu.Unlock()
			return nil
		})
	}
	if err := eg.Wait(); err != nil {
		return nil, err
	}
	return infos, nil
}

func GetInstancesWithoutOwner(regions []string) ([]InstanceInfo, error) {
	var mu sync.Mutex
	var infos []InstanceInfo
	eg, ctx := errgroup.WithContext(d.ctx)
	for _, region := range regions {
		region := region
		eg.Go(func() error {
			var token *string
			var regionalInfos []InstanceInfo
			for {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
				out, err := d.client.DescribeInstances(
					ctx,
					&ec2.DescribeInstancesInput{
						NextToken: token,
					},
					func(o *ec2.Options) {
						o.Region = region
					},
				)
				if err != nil {
					return fmt.Errorf("%s: %w", region, err)
				}
				for _, r := range out.Reservations {
					for _, i := range r.Instances {
						if getInstanceTagValue("Owner", i.Tags) == "" {
							regionalInfos = append(regionalInfos, InstanceInfo{
								Region:       region,
								InstanceID:   aws.ToString(i.InstanceId),
								InstanceName: getInstanceTagValue("Name", i.Tags),
								State:        i.State.Name,
							})
						}
					}
				}
				token = out.NextToken
				if token == nil {
					break
				}
			}
			mu.Lock()
			infos = append(infos, regionalInfos...)
			mu.Unlock()
			return nil
		})
	}
	if err := eg.Wait(); err != nil {
		return nil, err
	}
	return infos, nil
}

func GetInstancesWithOpenPermission(regions []string) ([]InstanceSecurityGroupInfo, error) {
	var mu sync.Mutex
	var infos []InstanceSecurityGroupInfo
	eg, ctx := errgroup.WithContext(d.ctx)
	for _, region := range regions {
		region := region
		eg.Go(func() error {
			sgmap, err := getOpenSecurityGroups(ctx, region)
			if err != nil {
				return fmt.Errorf("%s: %w", region, err)
			}
			if len(sgmap) == 0 {
				return nil
			}
			var sgids []string
			for sgid := range sgmap {
				sgids = append(sgids, sgid)
			}
			var token *string
			var regionalInfos []InstanceSecurityGroupInfo
			for {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
				out, err := d.client.DescribeInstances(
					ctx,
					&ec2.DescribeInstancesInput{
						NextToken: token,
						Filters: []types.Filter{
							{
								Name:   aws.String("instance.group-id"),
								Values: sgids,
							},
						},
					},
					func(o *ec2.Options) {
						o.Region = region
					},
				)
				if err != nil {
					return fmt.Errorf("%s: %w", region, err)
				}
				for _, r := range out.Reservations {
					for _, i := range r.Instances {
						var permissions []PermissionInfo
						for _, sg := range i.SecurityGroups {
							if perms, ok := sgmap[aws.ToString(sg.GroupId)]; ok {
								permissions = append(permissions, perms...)
							}
						}
						regionalInfos = append(regionalInfos, InstanceSecurityGroupInfo{
							Region:       region,
							InstanceID:   aws.ToString(i.InstanceId),
							InstanceName: getInstanceTagValue("Name", i.Tags),
							State:        i.State.Name,
							Permissions:  permissions,
						})
					}
				}
				token = out.NextToken
				if token == nil {
					break
				}
			}
			mu.Lock()
			infos = append(infos, regionalInfos...)
			mu.Unlock()
			return nil
		})
	}
	if err := eg.Wait(); err != nil {
		return nil, err
	}
	return infos, nil
}

func getOpenSecurityGroups(ctx context.Context, region string) (map[string][]PermissionInfo, error) {
	m := make(map[string][]PermissionInfo, defaultMapSize)
	var token *string
	for {
		openSgs, err := d.client.DescribeSecurityGroups(
			ctx,
			&ec2.DescribeSecurityGroupsInput{
				NextToken: token,
				Filters: []types.Filter{
					{
						Name:   aws.String("ip-permission.cidr"),
						Values: []string{"0.0.0.0/0"},
					},
				},
			},
			func(o *ec2.Options) {
				o.Region = region
			},
		)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", region, err)
		}
		for _, sg := range openSgs.SecurityGroups {
			var permissions []PermissionInfo
			for _, p := range sg.IpPermissions {
				for _, ip := range p.IpRanges {
					if aws.ToString(ip.CidrIp) == "0.0.0.0/0" {
						permissions = append(permissions, PermissionInfo{
							IpProtocol: aws.ToString(p.IpProtocol),
							FromPort:   aws.ToInt32(p.FromPort),
							ToPort:     aws.ToInt32(p.ToPort),
							AllowFrom:  aws.ToString(sg.GroupName),
						})
					}
				}
			}
			m[aws.ToString(sg.GroupId)] = permissions
		}
		token = openSgs.NextToken
		if token == nil {
			break
		}
	}
	return m, nil
}

func Handle(event *EventRequest) (*EventResponse, error) {
	fmt.Println("processing by golang")
	regions := getRegionNames(*event)
	apiPath := event.APIPath
	var body any
	var err error
	switch apiPath {
	case "/count/{regions}":
		body, err = GetInstancesCount(regions)
	case "/check-without-owner/{regions}":
		body, err = GetInstancesWithoutOwner(regions)
	case "/check-open-permission/{regions}":
		body, err = GetInstancesWithOpenPermission(regions)
	default:
		return nil, fmt.Errorf("api path \"%s\" not supported", apiPath)
	}
	if err != nil {
		return nil, err
	}
	resp := &EventResponse{
		MessageVersion: "1.0",
		Response: Response{
			ActionGroup:    event.ActionGroup,
			APIPath:        event.APIPath,
			HTTPMethod:     event.HTTPMethod,
			HTTPStatusCode: 200,
			ResponseBody: map[string]map[string]any{
				"application/json": {
					"body": body,
				},
			},
		},
	}
	if isDebug {
		result, err := json.Marshal(resp)
		if err != nil {
			return nil, err
		}
		fmt.Println(string(result))
	}
	return resp, nil
}

func main() {
	lambda.Start(Handle)
}
