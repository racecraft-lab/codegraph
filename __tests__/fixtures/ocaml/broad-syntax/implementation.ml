module Make (X : S) = struct
  type person = { name : string; count : int }
  type color = Red | Blue of int
  type poly = [ `A | `B of int ]
  type _ expr = Int : int -> int expr

  let rec map ~f ?(default=0) = function
    | [] -> default
    | x :: xs -> f x

  let with_local () =
    let module Local = struct
      let run () = ()
    end in
    Local.run ()

  let first_class = (module X : S)
  let marked [@inline] x = x

  class type counter_like = object
    method inc : unit
  end

  class counter = object
    val mutable count = 0
    method inc = count <- count + 1
  end
end
