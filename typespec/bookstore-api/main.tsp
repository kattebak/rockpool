import "@typespec/rest";
import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";
import "@typespec/versioning";

import "../lib/extensions/api-gateway.tsp";
import "../lib/util.tsp";
import "../lib/cognito-auth.tsp";
import "../models/author.tsp";
import "../models/book.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@useAuth(CognitoAuthorizer)
@service(#{ title: "Bookstore API" })
@server("https://api.example.com/", "Example base URL")
namespace BookstoreAPI;

// ============================================================================
// Author Operations
// ============================================================================

@route("/authors")
namespace AuthorOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op listAuthors(
    @query(#{ explode: true })
    @continuationToken
    continuationToken?: string,

    @query(#{ explode: true })
    count?: int32,
  ): ResultList<AuthorWithBookCount>;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @post
  op createAuthor(@body author: AuthorCreateParams): Author;
}

@route("/author/{authorId}")
namespace AuthorDetailOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op describeAuthor(@path authorId: UUID): AuthorWithBookCount;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @put
  op updateAuthor(
    @path authorId: UUID,
    @body author: AuthorUpdateParams,
  ): Author;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @delete
  op deleteAuthor(@path authorId: UUID): void;
}

@route("/author/{authorId}/books")
namespace AuthorBooksOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op listAuthorBooks(
    @path authorId: UUID,

    @query(#{ explode: true })
    @continuationToken
    continuationToken?: string,

    @query(#{ explode: true })
    count?: int32,
  ): ResultList<Book>;
}

// ============================================================================
// Book Operations
// ============================================================================

@route("/books")
namespace BookOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op listBooks(
    @query(#{ explode: true })
    @continuationToken
    continuationToken?: string,

    @query(#{ explode: true })
    count?: int32,

    @query(#{ explode: true })
    status?: BookStatus,

    @query(#{ explode: true })
    genre?: BookGenre,
  ): ResultList<BookWithAuthor>;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @post
  op createBook(@body book: BookCreateParams): Book;
}

@route("/book/{bookId}")
namespace BookDetailOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op describeBook(@path bookId: UUID): DescribeBookResponse;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @put
  op updateBook(
    @path bookId: UUID,
    @body book: BookUpdateParams,
  ): Book;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @delete
  op deleteBook(@path bookId: UUID): void;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @put
  @route("/publish")
  op publishBook(@path bookId: UUID): Book;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @put
  @route("/unpublish")
  op unpublishBook(@path bookId: UUID): Book;
}

// ============================================================================
// Search Operations
// ============================================================================

@route("/search")
namespace SearchOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  @route("/books")
  op searchBooks(
    @query(#{ explode: true })
    query: string,

    @query(#{ explode: true })
    @continuationToken
    continuationToken?: string,

    @query(#{ explode: true })
    count?: int32,
  ): ResultList<BookWithAuthor>;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  @route("/authors")
  op searchAuthors(
    @query(#{ explode: true })
    query: string,

    @query(#{ explode: true })
    @continuationToken
    continuationToken?: string,

    @query(#{ explode: true })
    count?: int32,
  ): ResultList<AuthorWithBookCount>;
}
