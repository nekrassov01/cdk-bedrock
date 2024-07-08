package slackbot

const (
	InitialMessage = ":loading2: 回答を準備中..."
	ContextMessage = ":ballot_box_with_check: スレッド内で会話履歴を保持しますが、一定時間入力がない場合はクリアされます。"
)

type QueueMessage struct {
	ChannelID               string
	TimeStamp               string
	InitialMessageChannelID string
	InitialMessageTimeStamp string
	InputText               string
}
