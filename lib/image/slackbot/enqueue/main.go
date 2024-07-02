package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"slackbot/messages"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/slack-go/slack"
	"github.com/slack-go/slack/slackevents"
)

const isDebug = true

var (
	wr   *wrapper
	envs = map[string]string{
		"AWS_REGION":           "",
		"QUEUE_URL":            "",
		"SLACK_OAUTH_TOKEN":    "",
		"SLACK_SIGNING_SECRET": "",
	}
)

type wrapper struct {
	ctx         context.Context
	slackClient *slack.Client
	queueClient *sqs.Client
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
		ctx:         ctx,
		slackClient: slack.New(envs["SLACK_OAUTH_TOKEN"]),
		queueClient: sqs.NewFromConfig(
			cfg,
			func(o *sqs.Options) {
				o.Region = envs["AWS_REGION"]
			},
		),
	}
}

func handle(req events.APIGatewayProxyRequest) (*events.APIGatewayProxyResponse, error) {
	if reason, ok := req.Headers["x-slack-retry-reason"]; ok && reason == "http_timeout" {
		return doOK("ok", "info: skip retrying due to http_timeout"), nil
	}

	if isDebug {
		r, err := json.Marshal(req)
		if err != nil {
			return nil, err
		}
		fmt.Println(string(r))
	}

	if err := doSecretsVerification(req); err != nil {
		return nil, err
	}

	body := req.Body
	event, err := slackevents.ParseEvent(json.RawMessage(body), slackevents.OptionNoVerifyToken())
	if err != nil {
		return nil, err
	}

	if isDebug {
		b, err := json.Marshal(event)
		if err != nil {
			return nil, err
		}
		fmt.Println(string(b))
	}

	if event.Type == slackevents.URLVerification {
		var r *slackevents.ChallengeResponse
		if err := json.Unmarshal([]byte(body), &r); err != nil {
			return nil, err
		}
		return doOK(r.Challenge, "success: verify url"), nil
	}

	if event.Type == slackevents.CallbackEvent {
		switch v := event.InnerEvent.Data.(type) {
		case *slackevents.AppMentionEvent:
			if err := doAppMentionEvent(v); err != nil {
				return nil, err
			}
		case *slackevents.MessageEvent:
			if err := doMessageEvent(v); err != nil {
				return nil, err
			}
		default:
		}
	}

	return doOK("ok", "success: handle event"), nil
}

func doSecretsVerification(req events.APIGatewayProxyRequest) error {
	header := http.Header{}
	for k, v := range req.Headers {
		header.Set(k, v)
	}

	sv, err := slack.NewSecretsVerifier(header, envs["SLACK_SIGNING_SECRET"])
	if err != nil {
		return err
	}

	if _, err := sv.Write([]byte(req.Body)); err != nil {
		return err
	}

	if err := sv.Ensure(); err != nil {
		return err
	}

	fmt.Println("success: verify signature")
	return nil
}

func doAppMentionEvent(event *slackevents.AppMentionEvent) error {
	ts := event.ThreadTimeStamp
	if ts == "" {
		ts = event.TimeStamp
	}
	return doSend(event.Channel, ts, event.Text)
}

func doMessageEvent(event *slackevents.MessageEvent) error {
	if event.ChannelType != "im" || event.BotID != "" || event.SubType == "message_changed" || event.SubType == "message_deleted" {
		fmt.Println("info: skip non-covered event")
		return nil
	}

	ts := event.ThreadTimeStamp
	if ts == "" {
		ts = event.TimeStamp
	}
	return doSend(event.Channel, ts, event.Text)
}

func doSend(channelID, timestamp, text string) error {
	// ack
	opts := []slack.MsgOption{
		slack.MsgOptionText(messages.InitialMessage, false),
		slack.MsgOptionTS(timestamp),
	}
	id, ts, err := wr.slackClient.PostMessage(channelID, opts...)
	if err != nil {
		return err
	}
	fmt.Println("success: send initial message")

	// enqueue
	msg := messages.QueueMessage{
		ChannelID:               channelID,
		TimeStamp:               timestamp,
		InitialMessageChannelID: id,
		InitialMessageTimeStamp: ts,
		InputText:               strings.TrimSuffix(text, messages.ContextMessage),
	}
	body, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	in := &sqs.SendMessageInput{
		MessageBody: aws.String(string(body)),
		QueueUrl:    aws.String(envs["QUEUE_URL"]),
	}
	if _, err := wr.queueClient.SendMessage(wr.ctx, in); err != nil {
		return err
	}
	fmt.Println("success: enqueue recieved message")

	return nil
}

func doOK(body, msg string) *events.APIGatewayProxyResponse {
	fmt.Println(msg)
	return &events.APIGatewayProxyResponse{
		Headers:    map[string]string{"Content-Type": "text"},
		Body:       body,
		StatusCode: http.StatusOK,
	}
}

func main() {
	lambda.Start(handle)
}
