import "@kattebak/typespec-zod-emitter";
import "typespec-electrodb-emitter";
import "../lib/string.tsp";
import "../lib/util.tsp";
import "./author.tsp";

enum BookStatus {
  Draft,
  Published,
  OutOfPrint,
  Discontinued,
}

enum BookGenre {
  Fiction,
  NonFiction,
  Mystery,
  ScienceFiction,
  Fantasy,
  Romance,
  Thriller,
  Horror,
  Biography,
  History,
  Science,
  SelfHelp,
  Cooking,
  Travel,
  Children,
}

@entity("book", "bookstore")
@index(
  "book",
  {
    pk: [Book.bookId],
    sk: [],
  }
)
@index(
  "byBookId",
  {
    collection: "book",
    index: "gsi0",
    pk: [Book.bookId],
    sk: [],
  }
)
@index(
  "byAuthor",
  {
    collection: "author",
    index: "gsi0",
    pk: [Book.authorId],
    sk: [Book.createdAt],
  }
)
@index(
  "byStatus",
  {
    index: "gsi1",
    pk: [Book.status],
    sk: [Book.publishedAt],
  }
)
@index(
  "byGenre",
  {
    index: "gsi2",
    pk: [Book.genre],
    sk: [Book.title],
  }
)
model Book {
  @visibility(Lifecycle.Read)
  bookId: UUID;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  authorId: UUID;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  title: String200;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  isbn?: ISBN;

  description?: String800;

  genre?: BookGenre;

  status?: BookStatus = BookStatus.Draft;

  @doc("Price in cents")
  price?: int32;

  @doc("Number of pages")
  pageCount?: int32;

  @visibility(Lifecycle.Read, Lifecycle.Update)
  publishedAt?: int64;

  coverImageUrl?: URL;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

model BookWithAuthor extends Book {
  @visibility(Lifecycle.Read)
  author?: Author;
}

model BookCreateParams is Create<Book>;

model BookUpdateParams is Update<Book>;

model DescribeBookResponse {
  book: Book;
  author: Author;
}
