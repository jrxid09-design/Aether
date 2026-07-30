const Result = require("../core/models/Result");

console.log(Result.ok({
    name: "Aether"
}));

console.log(Result.fail("Something went wrong"));