import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

// TODO: re-enable after kattebak/typespec-drizzle-orm-generator#8
// import "@kattebak/typespec-drizzle-orm-generator";
// using DrizzleEmitter;

using Http;
using TypeSpec.Rest;

@service(#{ title: "Tidepool Control Plane" })
@server("http://localhost:3000", "Development server")
namespace Tidepool;

enum WorkspaceStatus {
  creating,
  running,
  stopping,
  stopped,
  error,
}

// Drizzle decorators commented out until emitter is fixed:
// @table("workspaces", "tidepool")
model Workspace {
  @visibility(Lifecycle.Read)
  // @pk @uuid("base36", true)
  id: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  // @unique
  @minLength(3)
  @maxLength(63)
  @pattern("^[a-z0-9-]+$")
  name: string;

  @visibility(Lifecycle.Read)
  status: WorkspaceStatus;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  image: string;

  @visibility(Lifecycle.Read)
  vmIp?: string;

  @visibility(Lifecycle.Read)
  errorMessage?: string;

  // @createdAt
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;

  // @updatedAt
  @visibility(Lifecycle.Read)
  updatedAt: utcDateTime;
}

@route("/api/workspaces")
interface Workspaces {
  @get list(): Workspace[];

  @get read(@path id: string): Workspace;

  @post create(@body workspace: Workspace): {
    @statusCode statusCode: 201;
    @body workspace: Workspace;
  };

  @delete remove(@path id: string): {
    @statusCode statusCode: 204;
  };

  @route("{id}/start")
  @post
  start(@path id: string): Workspace;

  @route("{id}/stop")
  @post
  stop(@path id: string): Workspace;
}
