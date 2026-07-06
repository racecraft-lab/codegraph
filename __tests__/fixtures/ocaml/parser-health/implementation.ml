module Make (X : S) = struct
  type person = { name : string; count : int }
  type color = Red | Blue of int
  type poly = [ `A | `B of int ]
  type _ expr = Int : int -> int expr

  let rec map ~f ?(default=0) = function
    | [] -> default
    | x :: _ -> f x

  class counter = object
    val mutable count = 0
    method inc = count <- count + 1
  end
end
