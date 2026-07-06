[%%expect {| generated output is intentionally not indexed |}]
[@@@foo let floating_generated = Foo.run ()]
[%%foo let item_generated = Foo.run ()]

let marked [@inline] x = x
let annotated = 1 [@@foo Foo.run ()]
let extension_value = [%foo Foo.run ()]
