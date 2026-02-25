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

enum UserPrefsFileName {
  CodeServerSettings,
  CodeServerKeybindings,
  GitConfig,
}

@table("repository", "rockpool")
model Repository {
  @visibility(Lifecycle.Read)
  @pk
  @uuid("base36", true)
  id: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  full_name: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  owner: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  owner_type: "User" | "Organization";

  @visibility(Lifecycle.Create, Lifecycle.Read)
  owner_avatar: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  description?: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  default_branch: string;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  private: boolean;

  @createdAt
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}

@table("workspace", "rockpool")
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

  @visibility(Lifecycle.Create, Lifecycle.Read)
  description?: string;

  @visibility(Lifecycle.Read)
  vmIp?: string;

  @visibility(Lifecycle.Read)
  errorMessage?: string;

  @createdAt
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;

  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  autoSyncPrefs?: boolean;

  @updatedAt
  @visibility(Lifecycle.Read)
  updatedAt: utcDateTime;
}

@table("user_prefs_blob", "rockpool")
model UserPrefsBlob {
  @pk
  name: UserPrefsFileName;

  blob: string;

  @updatedAt
  @visibility(Lifecycle.Read)
  updatedAt: utcDateTime;
}

@table("port", "rockpool")
model Port {
  @pk
  @uuid("base36", false)
  @references(Workspace.id)
  @visibility(Lifecycle.Read)
  workspaceId: string;

  @pk
  @visibility(Lifecycle.Create, Lifecycle.Read)
  @TypeSpec.minValue(1024)
  @TypeSpec.maxValue(65535)
  port: int32;

  @visibility(Lifecycle.Create, Lifecycle.Read)
  label?: string;

  @createdAt
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}

@table("workspace_repository", "rockpool")
model WorkspaceRepository {
  @pk
  @references(Workspace.id)
  @uuid("base36", false)
  workspaceId: string;

  @pk
  @references(Repository.id)
  @uuid("base36", false)
  repositoryId: string;

  @createdAt
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

model GitHubRepo {
  full_name: string;
  owner: string;
  owner_type: "User" | "Organization";
  owner_avatar: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: utcDateTime;
}

model GitHubRepoListResponse {
  items: GitHubRepo[];
  next_page: int32 | null;
}

model GitHubRepoSearchResponse {
  items: GitHubRepo[];
  total_count: int32;
  next_page: int32 | null;
}

@route("/api/settings")
interface Settings {
  @get list(): UserPrefsBlob[];

  @get read(@path name: UserPrefsFileName): UserPrefsBlob;

  @put save(
    @path name: UserPrefsFileName,
    @query workspaceId: string,
  ): UserPrefsBlob;
}

@route("/api/github")
interface GitHub {
  @route("repos")
  @get
  listRepos(
    @query page?: int32,
    @query per_page?: int32,
    @query sort?: "created" | "updated" | "pushed" | "full_name",
  ): GitHubRepoListResponse;

  @route("repos/search")
  @get
  searchRepos(
    @query q: string,
    @query page?: int32,
    @query per_page?: int32,
  ): GitHubRepoSearchResponse;
}
