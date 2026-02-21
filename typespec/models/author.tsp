import "@kattebak/typespec-zod-emitter";
import "typespec-electrodb-emitter";
import "../lib/string.tsp";
import "../lib/util.tsp";

@entity("author", "bookstore")
@index(
  "author",
  {
    pk: [Author.authorId],
    sk: [],
  }
)
@index(
  "byAuthorId",
  {
    collection: "author",
    index: "gsi0",
    pk: [Author.authorId],
    sk: [],
  }
)
@index(
  "byName",
  {
    index: "gsi1",
    pk: [],
    sk: [Author.name],
  }
)
model Author {
  @visibility(Lifecycle.Read)
  authorId: UUID;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  name: DisplayName;

  biography?: String800;

  email?: Email;

  website?: URL;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

model AuthorWithBookCount extends Author {
  @visibility(Lifecycle.Read)
  bookCount?: int32;
}

model AuthorCreateParams is Create<Author>;

model AuthorUpdateParams is Update<Author>;
