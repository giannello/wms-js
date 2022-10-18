import {Then} from "@cucumber/cucumber";
import assert from "assert";

Then('the stick responds with {string}', async function (value) {
    assert.strictEqual(this['response'], value)
});

Then('the stick throws an error', function () {
    assert.strictEqual(typeof this['response'], typeof new Error)
});

Then('the stick responds without errors', function () {
    assert.strictEqual(this['response'], true)
});
