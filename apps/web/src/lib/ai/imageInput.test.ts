import assert from "node:assert/strict";
import {
  base64ByteLength,
  isValidAiImage,
  type AiImageInput,
} from "./imageInput";

const png: AiImageInput = {
  mediaType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
};

assert.equal(isValidAiImage(png), true);
assert.equal(base64ByteLength(png.data), 69);
assert.equal(isValidAiImage({ ...png, mediaType: "image/jpeg" }), false);
assert.equal(isValidAiImage({ ...png, data: "not base64" }), false);
