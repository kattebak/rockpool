import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";
import "@kattebak/typespec-drizzle-orm-generator";

using Http;
using TypeSpec.Rest;
using DrizzleEmitter;

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

@table("workspaces", "tidepool")
model Workspace {
  @TypeSpec.visibility(Lifecycle.Read)
  @pk @uuid("base36", true)
  id: string;

  @TypeSpec.visibility(Lifecycle.Create, Lifecycle.Read)
  @unique
  @minLength(3)
  @maxLength(63)
  @pattern("^[a-z0-9-]+$")
  name: string;

  @TypeSpec.visibility(Lifecycle.Read)
  status: WorkspaceStatus;

  @TypeSpec.visibility(Lifecycle.Create, Lifecycle.Read)
  image: string;

  @TypeSpec.visibility(Lifecycle.Read)
  vmIp?: string;

  @TypeSpec.visibility(Lifecycle.Read)
  errorMessage?: string;

  @createdAt
  @TypeSpec.visibility(Lifecycle.Read)
  createdAt: utcDateTime;

  @updatedAt
  @TypeSpec.visibility(Lifecycle.Read)
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
