def normalize_with_local_class(values, prefix):
    transform = lambda value: value.strip().lower()

    class LocalFormatter:
        def __init__(self, label):
            self.label = label

        def format_all(self, raw_values):
            return [f"{self.label}:{transform(value)}" for value in raw_values]

    return LocalFormatter(prefix).format_all(values)
