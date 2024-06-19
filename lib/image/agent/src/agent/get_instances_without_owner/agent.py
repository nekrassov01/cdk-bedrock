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
        get_instances_without_owner(region["RegionName"])
    return json.dumps(obj=results, ensure_ascii=False)


def get_instances_without_owner(region_name):
    try:
        client = boto3.client("ec2", region_name=region_name)
        instances = client.describe_instances()
        for reservation in instances["Reservations"]:
            for instance in reservation["Instances"]:
                if get_instance_tag_value("Owner", instance) == "":
                    result = {
                        "region": region_name,
                        "instance_id": instance["InstanceId"],
                        "instance_name": get_instance_tag_value("Name", instance),
                    }
                    results.append(result)
    except Exception as e:
        print("Error: {}: {}".format(region_name, e))


def get_instance_tag_value(key, instance) -> str:
    return next(
        (
            tag["Value"]
            for tag in instance.get("Tags")
            if tag["Key"].lower() == key.lower()
        ),
        "",
    )
