open Foo
include Common.S

module Built = Functors.Make(Foo)

let helper () = 3
let local_call () = helper ()
let use () = Foo.run ()
let leak () = Foo.hidden ()
let bare_leak () = hidden ()
let local_open () = Foo.(run ())
