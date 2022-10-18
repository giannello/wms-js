import {Then, When} from "@cucumber/cucumber";
import * as assert from "assert";

When('I ask for the stick name', async function () {
    this['response'] = await this['wms'].getName();
});

Then('the stick responds with {string}', async function (value) {
    assert.strictEqual(this['response'], value)
});
