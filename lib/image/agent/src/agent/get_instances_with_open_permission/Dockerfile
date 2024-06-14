FROM public.ecr.aws/lambda/python:3.12
ARG HTTP_PROXY
COPY requirements.txt ${LAMBDA_TASK_ROOT}
COPY agent.py ${LAMBDA_TASK_ROOT}
RUN pip install -r requirements.txt --proxy ${HTTP_PROXY}
CMD [ "agent.handler" ]
