import json

import boto3

client = boto3.client("ec2")
regions = client.describe_regions()["Regions"]
results = []


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
    for region in regions:
        get_instances_with_open_permission(region["RegionName"])
    return json.dumps(obj=results, ensure_ascii=False)


def get_instances_with_open_permission(region_name: str):
    try:
        client = boto3.client("ec2", region_name=region_name)
        security_groups = client.describe_security_groups(
            Filters=[{"Name": "ip-permission.cidr", "Values": ["0.0.0.0/0"]}]
        )
        if not security_groups["SecurityGroups"]:
            return None
        instances = client.describe_instances(
            Filters=[
                {
                    "Name": "instance.group-id",
                    "Values": [
                        security_group["GroupId"]
                        for security_group in security_groups["SecurityGroups"]
                    ],
                }
            ]
        )
        for reservation in instances["Reservations"]:
            for instance in reservation["Instances"]:
                permissions = []
                for security_group in instance["SecurityGroups"]:
                    security_group_details = client.describe_security_groups(
                        GroupIds=[security_group["GroupId"]]
                    )
                    for security_group_detail in security_group_details[
                        "SecurityGroups"
                    ]:
                        for permission in security_group_detail["IpPermissions"]:
                            for ip_range in permission.get("IpRanges"):
                                if ip_range.get("CidrIp") == "0.0.0.0/0":
                                    permission_detail = {
                                        "protocol": permission.get("IpProtocol"),
                                        "from_port": permission.get("FromPort"),
                                        "to_port": permission.get("ToPort"),
                                        "allow_from": security_group["GroupName"],
                                    }
                                    permissions.append(permission_detail)
                if permissions:
                    result = {
                        "region": region_name,
                        "instance_id": instance["InstanceId"],
                        "instance_name": get_instance_tag_value("Name", instance),
                        "permissions": permissions,
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
