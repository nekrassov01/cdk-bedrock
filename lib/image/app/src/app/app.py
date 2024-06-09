import os

import streamlit as st
from langchain.prompts import PromptTemplate
from langchain_aws.llms import BedrockLLM
from langchain_aws.retrievers import AmazonKnowledgeBasesRetriever
from langchain_core.runnables import RunnablePassthrough

template = """
###ドキュメント
{context}
###

###質問
{question}
###

Human: あなたは優秀なネットワークエンジニアです。ドキュメントセクションの内容を参照し、質問セクションに対して1000文字程度の日本語で回答してください。
もし質問セクションの内容がドキュメントにない場合は「ドキュメントに記載がありません」と回答してください。
またドキュメントにはコマンドリファレンスを含むため、質問に沿ったコマンドをコードブロックで回答してください。

Assistant:
"""


retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id=os.environ["KNOWLEDGE_BASE_ID"],
    retrieval_config={
        "vectorSearchConfiguration": {"numberOfResults": 4},
    },
    region_name=os.environ["TARGET_REGION"],
)

prompt = PromptTemplate(
    input_variables=["context", "question"],
    template=template,
)

model = BedrockLLM(
    model_id=os.environ["MODEL_ID"],
    model_kwargs={"max_tokens_to_sample": 1000},
    verbose=True,
    region_name=os.environ["TARGET_REGION"],
)

chain = {"context": retriever, "question": RunnablePassthrough()} | prompt | model

st.title("TEST")
input_text = st.text_input("Input")
submit = st.button("Submit")

if submit:
    result = chain.invoke(input_text)
    st.write(result)
