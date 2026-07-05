open Foo
include Common.S

module Built = Make(Foo)

let use () = Foo.run ()
