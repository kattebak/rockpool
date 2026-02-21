@maxLength(800)
scalar String800 extends string;

@maxLength(400)
scalar String400 extends string;

@maxLength(200)
scalar String200 extends string;

@maxLength(140)
scalar String140 extends string;

@maxLength(64)
scalar String64 extends string;

@maxLength(32)
scalar String32 extends string;

@maxLength(25)
@minLength(25)
scalar UUID extends string;

@minLength(3)
@maxLength(48)
scalar DisplayName extends string;

@maxLength(13)
@minLength(10)
scalar ISBN extends string;

@format("email")
@maxLength(200)
scalar Email extends string;

@format("uri")
@maxLength(400)
scalar URL extends string;
