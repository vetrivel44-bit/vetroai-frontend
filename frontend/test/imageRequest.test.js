import { test } from "node:test";
import assert from "node:assert/strict";
import { detectImagePrompt, imageBlockPrompt, withoutImageBlock, wantsDrawing } from "../src/lib/imageRequest.js";

test("requests to make a picture are caught, in many wordings", () => {
  const cases = {
    "Create an image of a cat in space": "a cat in space",
    "create images of cats playing football": "cats playing football",
    "make a pic of my dog as a superhero": "my dog as a superhero",
    "can you create an image of a sunset over the sea?": "a sunset over the sea",
    "i want an image of a sunset over the sea": "a sunset over the sea",
    "show me a picture of a dragon": "a dragon",
    "Generate 3 images of a futuristic Chennai": "a futuristic Chennai",
  };
  for (const [message, prompt] of Object.entries(cases)) assert.equal(detectImagePrompt(message), prompt, message);
});

test("a kind of picture keeps its name: a logo, a poster, a cartoon", () => {
  assert.equal(detectImagePrompt("generate a logo for my bakery"), "a logo for my bakery");
  assert.equal(detectImagePrompt("make me a poster for diwali sale"), "a poster for diwali sale");
  assert.equal(detectImagePrompt("make a cartoon of a happy elephant"), "a cartoon of a happy elephant");
  assert.equal(detectImagePrompt("give me a wallpaper of mountains at night"), "a wallpaper of mountains at night");
});

test("not a request to make a picture: the chat answers instead", () => {
  assert.equal(detectImagePrompt("Can you create images?"), null, "a question about the ability: it says yes and how");
  assert.equal(detectImagePrompt("do you make logos"), null);
  assert.equal(detectImagePrompt("show me photos of Ooty"), null, "real photos, shown under the answer");
  assert.equal(detectImagePrompt("draw the human heart"), null, "a drawing, drawn in the chat");
  assert.equal(detectImagePrompt("What is image processing?"), null);
  assert.equal(wantsDrawing("sketch a circuit"), true);
});

test("a reply's image block gives the picture to make, and is taken out of the text", () => {
  const reply = "Here's your picture of a cat!\n\n```image\nA fluffy orange cat napping on a sunny windowsill,\nwatercolour style, soft morning light\n```";
  assert.equal(imageBlockPrompt(reply), "A fluffy orange cat napping on a sunny windowsill, watercolour style, soft morning light");
  assert.equal(withoutImageBlock(reply), "Here's your picture of a cat!");
  assert.equal(imageBlockPrompt("No picture here.\n```js\nconst a = 1;\n```"), null);
  assert.equal(imageBlockPrompt("```image\n\n```"), null);
});
