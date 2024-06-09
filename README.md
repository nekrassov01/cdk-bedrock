cdk-bedrock
===========

Create a Fargate Service in CDK that makes requests to Knowledge Base for Amazon Bedrock.

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
    "httpProxy": "http://my-proxy.com:port"
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
