open Foo
include Common.S

module Built = Make(Foo)

let use () = Foo.run ()
let leak () = Foo.hidden ()
let local_open () = Foo.(run ())
