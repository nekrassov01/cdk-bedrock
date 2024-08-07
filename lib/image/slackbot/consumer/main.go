package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"slackbot"
	"strings"

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
	wr   *wrapper
	envs = map[string]string{
		"AWS_REGION":           "",
		"AGENT_ID":             "",
		"AGENT_ALIAS_ID":       "",
		"SLACK_OAUTH_TOKEN":    "",
		"SLACK_SIGNING_SECRET": "",
	}
)

type wrapper struct {
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

	wr = &wrapper{
		ctx: ctx,
		slackClient: slack.New(
			envs["SLACK_OAUTH_TOKEN"],
			slack.OptionDebug(isDebug),
			slack.OptionLog(log.New(os.Stdout, "slack: ", log.Lshortfile|log.LstdFlags)),
		),
		agentClient: bedrockagentruntime.NewFromConfig(
			cfg,
			func(o *bedrockagentruntime.Options) {
				o.Region = envs["AWS_REGION"]
			},
		),
	}
}

func handle(req events.SQSEvent) error {
	var msg slackbot.QueueMessage
	body := req.Records[0].Body
	if err := json.Unmarshal([]byte(body), &msg); err != nil {
		return err
	}
	if isDebug {
		fmt.Println(body)
	}

	answer, err := invokeAgent(msg.InputText, msg.TimeStamp)
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
					Type: slack.MarkdownType,
					Text: answer,
				},
			},
			&slack.DividerBlock{
				Type: slack.MBTDivider,
			},
			&slack.ContextBlock{
				Type: slack.MBTContext,
				ContextElements: slack.ContextElements{
					Elements: []slack.MixedElement{
						&slack.TextBlockObject{
							Type: slack.PlainTextType,
							Text: slackbot.ContextMessage,
						},
					},
				},
			},
		),
		slack.MsgOptionTS(msg.TimeStamp),
	}
	if _, _, err := wr.slackClient.PostMessage(msg.ChannelID, opts...); err != nil {
		return err
	}

	if _, _, err := wr.slackClient.DeleteMessage(msg.InitialMessageChannelID, msg.InitialMessageTimeStamp); err != nil {
		return err
	}

	fmt.Println("success: finish message processing")
	return nil
}

func invokeAgent(text, timestamp string) (string, error) {
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

	var b strings.Builder
	var n int
	for event := range out.GetStream().Events() {
		switch v := event.(type) {
		case *types.ResponseStreamMemberChunk:
			b.WriteString(string(v.Value.Bytes))
			n++
		case *types.UnknownUnionMember:
			return "", fmt.Errorf("unknown tag: %s", v.Tag)
		default:
			return "", fmt.Errorf("union is nil or unknown type")
		}
	}

	fmt.Printf("success: invoke agent: total chunks received: %d\n", n)
	return b.String(), nil
}

func main() {
	lambda.Start(handle)
}
