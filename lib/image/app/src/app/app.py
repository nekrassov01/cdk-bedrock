import json
import os
import uuid

import boto3
import streamlit as st
import streamlit_authenticator as sa


def main():
    if "session_id" not in st.session_state:
        st.session_state.session_id = str(uuid.uuid4())

    if "messages" not in st.session_state:
        st.session_state.messages = []

    if "selected_preset" not in st.session_state:
        st.session_state.selected_preset = ""

    if "use_preset" not in st.session_state:
        st.session_state.use_preset = False

    auth = sa.Authenticate(
        credentials={
            "usernames": {
                "admin": {
                    "name": os.environ["USERNAME"],
                    "password": os.environ["PASSWORD"],
                }
            }
        },
        cookie_name=os.environ["COOKIE_NAME"],
        cookie_key=os.environ["COOKIE_KEY"],
        cookie_expiry_days=1,
    )

    auth.login()
    if st.session_state["authentication_status"] is True:
        st.title("AWSのことなんでもこたえるマン")
        set_sidebar(auth)
        set_messages()
        if prompt := get_user_prompt():
            handle_prompt(prompt)
    elif st.session_state["authentication_status"] is False:
        st.error("Error: Logion failed.")


def set_sidebar(auth):
    actions = json.loads(os.environ["ACTION_LABELS"])
    with st.sidebar:
        st.session_state.selected_preset = st.selectbox("リソース調査", actions)
        if st.button("依頼"):
            st.session_state.use_preset = True
        st.divider()
        auth.logout("Logout", "sidebar")


def set_messages():
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])


def get_user_prompt():
    prompt = ""
    if st.session_state.use_preset:
        prompt = st.session_state.selected_preset
    if user_input := st.chat_input("なんでもきいてください"):
        prompt = user_input
    return prompt


def handle_prompt(prompt):
    with st.chat_message("Human"):
        st.markdown(prompt)
    st.session_state.messages.append({"role": "Human", "content": prompt})

    with st.chat_message("Assistant"):
        with st.spinner("回答を準備中..."):
            response = invoke_agent(prompt)
            result = ""
            if stream := response.get("completion"):
                for event in stream:
                    if chunk := event.get("chunk"):
                        if bytes := chunk.get("bytes"):
                            result += bytes.decode("utf-8")
                st.markdown(result)
                st.session_state.messages.append(
                    {"role": "Assistant", "content": result}
                )


def invoke_agent(prompt):
    try:
        client = boto3.client(
            service_name="bedrock-agent-runtime",
            region_name=os.environ["TARGET_REGION"],
        )

        response = client.invoke_agent(
            inputText=prompt,
            agentId=os.environ["AGENT_ID"],
            agentAliasId=os.environ["AGENT_ALIAS_ID"],
            sessionId=st.session_state.session_id,
            enableTrace=False,
            endSession=False,
        )

    except Exception as e:
        print("Error: {}".format(e))
        raise

    return response


if __name__ == "__main__":
    main()
