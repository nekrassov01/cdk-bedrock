package messages

const (
	InitialMessage  = ":loading2: 回答を準備中..."
	ContexstMessage = ":ballot_box_with_check: スレッド内で会話履歴を保持しますが、一定時間入力がない場合はクリアされます。\n:ballot_box_with_check: SlackBotは、応答に3秒以上かかるとリトライを行います。Lambdaのコールドスタートを考慮し、リトライ理由がタイムアウトの場合はリトライをスキップするよう制御しています。"
)

type QueueMessage struct {
	ChannelID               string
	TimeStamp               string
	InitialMessageChannelID string
	InitialMessageTimeStamp string
	InputText               string
}
