import json

import boto3

client = boto3.client("ec2")
results = []


def handler(event, context):
    region = get_region(event)
    if region != "":
        body = run_with_region(event["apiPath"], region)
    else:
        body = run_with_all_regions(event["apiPath"])
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


def run_with_region(apiPath, region):
    if apiPath == "/count/{region}":
        get_instances_count(region)
    elif apiPath == "/check-without-owner/{region}":
        get_instances_without_owner(region)
    elif apiPath == "/check-open-permission/{region}":
        get_instances_with_open_permission(region)
    else:
        print('Error: apiPath "{}" not supported'.format(apiPath))
    return json.dumps(obj=results, ensure_ascii=False)


def run_with_all_regions(apiPath):
    for region in client.describe_regions()["Regions"]:
        if apiPath == "/count":
            get_instances_count(region["RegionName"])
        elif apiPath == "/check-without-owner":
            get_instances_without_owner(region["RegionName"])
        elif apiPath == "/check-open-permission":
            get_instances_with_open_permission(region["RegionName"])
        else:
            print('Error: apiPath "{}" not supported'.format(apiPath))
            break
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


def get_instances_without_owner(region_name: str):
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


def get_region(event) -> str:
    region = next(
        (
            parameter["value"]
            for parameter in event.get("parameters", [])
            if parameter["name"] == "region"
        ),
        "",
    )
    return region
