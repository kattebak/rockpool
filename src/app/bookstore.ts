import os from "node:os";
import { App } from "aws-cdk-lib";
import { BookstoreStack } from "#stacks/bookstore/bookstore-stack.js";
import { formatStackName } from "#lib/format.js";

const app = new App();

const username = app.node.tryGetContext("username") ?? os.userInfo().username;
const account = app.node.tryGetContext("account") ?? process.env.CDK_DEFAULT_ACCOUNT;
const region = app.node.tryGetContext("region") ?? "eu-central-1";

const callbackUrls = app.node.tryGetContext("callbackUrls")?.split(",") ?? [
	"http://localhost:3000/callback",
];
const logoutUrls = app.node.tryGetContext("logoutUrls")?.split(",") ?? [
	"http://localhost:3000/logout",
];
const allowedOrigins = app.node.tryGetContext("allowedOrigins")?.split(",") ?? [
	"http://localhost:3000",
];

new BookstoreStack(app, formatStackName({ username }), {
	username,
	callbackUrls,
	logoutUrls,
	allowedOrigins,
	env: {
		account,
		region,
	},
});

app.synth();
