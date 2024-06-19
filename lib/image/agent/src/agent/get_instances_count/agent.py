import json

import boto3

client = boto3.client("ec2")
regions = client.describe_regions()["Regions"]


def handler(event, context):
    body = run_with_regions()
    response = {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event["actionGroup"],
            "apiPath": event["apiPath"],
            "httpMethod": event["httpMethod"],
            "httpStatusCode": 200,
            "responseBody": {"application/json": {"body": body}},
        },
    }
    return response


def run_with_regions():
    global results
    results = []
    for region in regions:
        get_instances_count(region["RegionName"])
    return json.dumps(obj=results, ensure_ascii=False)


def get_instances_count(region_name: str):
    try:
        client = boto3.client("ec2", region_name=region_name)
        instances = client.describe_instances()
        instance_count = 0
        instance_running = 0
        for reservation in instances["Reservations"]:
            instance_count += len(reservation["Instances"])
            for instance in reservation["Instances"]:
                if instance["State"]["Name"] == "running":
                    instance_running += 1
        result = {
            "region": region_name,
            "instance_count": instance_count,
            "instance_running": instance_running,
        }
        results.append(result)
    except Exception as e:
        print("Error: {}: {}".format(region_name, e))
