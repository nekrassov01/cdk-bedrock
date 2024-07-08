FROM golang:1.22.4-alpine3.20 as build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NAME
WORKDIR /slackbot
COPY go.mod go.sum utils.go ./
COPY ${NAME} ./${NAME}/
RUN HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} go build -o main ${NAME}/main.go

FROM alpine:3.20
COPY --from=build /slackbot/main /main
ENTRYPOINT [ "/main" ]
