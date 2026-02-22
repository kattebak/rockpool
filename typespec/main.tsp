import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";
import "@kattebak/typespec-drizzle-orm-generator";

using Http;
using TypeSpec.Rest;

@service(#{ title: "Rockpool Control Plane" })
@server("http://localhost:3000", "Development server")
namespace Rockpool;

enum WorkspaceStatus {
  creating,
  running,
  stopping,
  stopped,
  error,
}

@table("workspaces", "rockpool")
model Workspace {
  @visibility(Lifecycle.Read)
  @pk
  @uuid("base36", true)
  id: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  @unique
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

  @createdAt
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;

  @updatedAt
  @visibility(Lifecycle.Read)
  updatedAt: utcDateTime;
}

model Port {
  @visibility(Lifecycle.Create, Lifecycle.Read)
  @TypeSpec.minValue(1024)
  @TypeSpec.maxValue(65535)
  port: int32;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  label?: string;

  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}

model WorkspaceListResponse {
  items: Workspace[];
  nextCursor?: string;
}

@route("/api/workspaces")
interface Workspaces {
  @get list(
    @query limit?: int32,
    @query cursor?: string,
  ): WorkspaceListResponse;

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

  @route("{id}/ports")
  @get
  listPorts(@path id: string): Port[];

  @route("{id}/ports")
  @post
  addPort(@path id: string, @body port: Port): {
    @statusCode statusCode: 201;
    @body port: Port;
  };

  @route("{id}/ports/{port}")
  @delete
  removePort(@path id: string, @path port: int32): {
    @statusCode statusCode: 204;
  };
}
