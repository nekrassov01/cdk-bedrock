package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"slackbot/messages"
	"strings"
	"sync"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockagentruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockagentruntime/types"
	"github.com/slack-go/slack"
)

const isDebug = true

var (
	wr   *Wrapper
	envs = map[string]string{
		"AWS_REGION":           "",
		"AGENT_ID":             "",
		"AGENT_ALIAS_ID":       "",
		"SLACK_OAUTH_TOKEN":    "",
		"SLACK_SIGNING_SECRET": "",
	}
)

type Wrapper struct {
	ctx         context.Context
	slackClient *slack.Client
	agentClient *bedrockagentruntime.Client
}

func init() {
	for k := range envs {
		envs[k] = os.Getenv(k)
		if envs[k] == "" {
			log.Fatalf("invalid environment variable: %s", k)
		}
	}

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(
		ctx,
		config.WithRetryMode(aws.RetryModeStandard),
		config.WithRetryMaxAttempts(10),
	)
	if err != nil {
		log.Fatal(err)
	}

	wr = &Wrapper{
		ctx:         ctx,
		slackClient: slack.New(envs["SLACK_OAUTH_TOKEN"]),
		agentClient: bedrockagentruntime.NewFromConfig(
			cfg,
			func(o *bedrockagentruntime.Options) {
				o.Region = envs["AWS_REGION"]
			},
		),
	}
}

func (wr *Wrapper) handle(req events.SQSEvent) error {
	var msg messages.QueueMessage
	body := req.Records[0].Body
	if err := json.Unmarshal([]byte(body), &msg); err != nil {
		return err
	}
	if isDebug {
		fmt.Println(body)
	}

	answer, err := wr.invokeAgent(msg.InputText, msg.TimeStamp)
	if err != nil {
		return err
	}
	if isDebug {
		fmt.Println(answer)
	}

	opts := []slack.MsgOption{
		slack.MsgOptionBlocks(
			&slack.SectionBlock{
				Type: slack.MBTSection,
				Text: &slack.TextBlockObject{
					Type: "mrkdwn",
					Text: answer,
				},
			},
			slack.NewDividerBlock(),
			&slack.ContextBlock{
				Type: "context",
				ContextElements: slack.ContextElements{
					Elements: []slack.MixedElement{
						slack.TextBlockObject{
							Type: "plain_text",
							Text: messages.ContexstMessage,
						},
					},
				},
			},
		),
		slack.MsgOptionTS(msg.TimeStamp),
	}
	if _, _, err = wr.slackClient.PostMessage(msg.ChannelID, opts...); err != nil {
		return err
	}

	if _, _, err := wr.slackClient.DeleteMessage(msg.InitialMessageChannelID, msg.InitialMessageTimeStamp); err != nil {
		return err
	}

	fmt.Println("success: finish message processing")
	return nil
}

func (wr *Wrapper) invokeAgent(text, timestamp string) (string, error) {
	in := &bedrockagentruntime.InvokeAgentInput{
		InputText:    aws.String(text),
		AgentId:      aws.String(envs["AGENT_ID"]),
		AgentAliasId: aws.String(envs["AGENT_ALIAS_ID"]),
		EnableTrace:  aws.Bool(false),
		EndSession:   aws.Bool(false),
		SessionId:    aws.String(timestamp),
	}
	out, err := wr.agentClient.InvokeAgent(wr.ctx, in)
	if err != nil {
		return "", err
	}

	cch := make(chan string) // chunk
	ech := make(chan error)  // error
	dch := make(chan bool)   // done

	var wg sync.WaitGroup
	var sb strings.Builder
	var n int

	wg.Add(1)
	go func() {
		defer wg.Done()
		for event := range out.GetStream().Events() {
			switch v := event.(type) {
			case *types.ResponseStreamMemberChunk:
				cch <- string(v.Value.Bytes)
			case *types.UnknownUnionMember:
				ech <- fmt.Errorf("unknown tag: %s", v.Tag)
				return
			default:
				ech <- fmt.Errorf("union is nil or unknown type")
				return
			}
		}
		dch <- true
	}()

	go func() {
		wg.Wait()
		close(cch)
		close(ech)
		close(dch)
	}()
	for {
		select {
		case chunk := <-cch:
			sb.WriteString(chunk)
			n++
		case err := <-ech:
			return "", err
		case <-dch:
			fmt.Printf("success: invoke agent: total chunks received: %d\n", n)
			return sb.String(), nil
		}
	}
}

func main() {
	lambda.Start(wr.handle)
}