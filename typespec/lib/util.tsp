import "typespec-electrodb-emitter";
import "./string.tsp";

model ResultList<T> {
  @continuationToken continuationToken?: String800;
  items: T[];
}

model TimestampedEntity {
  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
