import { HttpError } from "../lib/errors.js";

export function validate(schema, location = "body") {
  return (req, _res, next) => {
    const input = req[location];
    const result = schema.safeParse(input);
    if (!result.success) {
      return next(
        new HttpError(
          400,
          "提交的数据不符合要求",
          "VALIDATION_ERROR",
          result.error.flatten(),
        ),
      );
    }
    if (
      req.method === "PATCH" &&
      location === "body" &&
      input &&
      typeof input === "object" &&
      !Array.isArray(input)
    ) {
      req[location] = Object.fromEntries(
        Object.keys(input)
          .filter((key) => Object.hasOwn(result.data, key))
          .map((key) => [key, result.data[key]]),
      );
    } else {
      req[location] = result.data;
    }
    return next();
  };
}
