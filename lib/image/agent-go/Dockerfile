FROM golang:1.22.4-alpine3.20 as build
ARG HTTP_PROXY
ARG HTTPS_PROXY
WORKDIR /agent-go
COPY go.mod go.sum ./
COPY main.go .
RUN HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} go build -o main main.go
FROM alpine:3.20
COPY --from=build /agent-go/main /main
ENTRYPOINT [ "/main" ]
