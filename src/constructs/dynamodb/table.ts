import { RemovalPolicy } from "aws-cdk-lib";
import {
	AttributeType,
	Billing,
	StreamViewType,
	TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import type { IStream } from "aws-cdk-lib/aws-kinesis";
import type { Construct } from "constructs";

export interface DynamoDBTableV2Props {
	kinesisStream?: IStream;
	tableName: string;
}

export class DynamoDBTableV2 extends TableV2 {
	private localSecondaryIndexCount = 0;
	private globalSecondaryIndexCount = 0;

	constructor(scope: Construct, id: string, props: DynamoDBTableV2Props) {
		super(scope, id, {
			kinesisStream: props.kinesisStream,
			tableName: props.tableName,
			partitionKey: { name: "pk", type: AttributeType.STRING },
			sortKey: { name: "sk", type: AttributeType.STRING },
			dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES,
			billing: Billing.onDemand(),
			removalPolicy: RemovalPolicy.RETAIN,
			pointInTimeRecoverySpecification: {
				pointInTimeRecoveryEnabled: true,
			},
		});
	}

	public addLocalIndex() {
		const index = this.localSecondaryIndexCount++;

		if (this.localSecondaryIndexCount > 4) {
			throw new Error("Cannot have more than 5 LSI");
		}

		this.addLocalSecondaryIndex({
			sortKey: {
				name: `lsi${index}sk`,
				type: AttributeType.STRING,
			},
			indexName: `lsi${index}`,
		});
	}

	public addGlobalIndex() {
		const index = this.globalSecondaryIndexCount++;

		if (this.globalSecondaryIndexCount > 19) {
			throw new Error("Cannot have more than 20 GSI");
		}

		this.addGlobalSecondaryIndex({
			partitionKey: {
				name: `gsi${index}pk`,
				type: AttributeType.STRING,
			},
			sortKey: {
				name: `gsi${index}sk`,
				type: AttributeType.STRING,
			},
			indexName: `gsi${index}`,
		});
	}
}
