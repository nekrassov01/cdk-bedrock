cdk-bedrock
===========

Create a Slackbot API in CDK that makes requests to Agents for Amazon Bedrock.

![diagram_pt1](docs/diagram.png)

Prerequisites
-------------

First, define the context as follows:

```json
{
  ...
  "context": {
    ...
    "owner": "user",
    "serviceName": "my-service",
    "hostZoneName": "example.com",
    "allowedIps": ["0.0.0.0/0"],
    "httpProxy": "http://my-proxy.com:port",
    "repository": "user/reponame", // Your ECR repository
    "slackOAuthToken": "foo",
    "slackSigningSecret": "bar",
    "hasUI": false // true: Streamlit on ECS, false: Slackbot
  }
}
```

Usage
-----

Deploy resources with the following command:

```sh
cdk synth
cdk deploy
```
