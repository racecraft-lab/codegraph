open Utils
include Common.S

val map : f:(int -> int) -> ?default:int -> int list -> int
val callbacks : (int -> int) list
external now : unit -> float = "c_now"

type person = { name : string; count : int }
type color = Red | Blue of int
type _ expr = Int : int -> int expr
type poly = [ `A | `B of int ]

module M : sig val run : unit -> unit end
module type S = sig val make : unit -> person end
class type counter_like = object method inc : unit end
class counter : object method inc : unit end
