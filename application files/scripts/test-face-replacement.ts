import { GoogleGenAI } from '@google/genai';
import { config } from 'dotenv';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
// Load a local key without exposing it in browser code or logs.
config({ path: path.join(appDirectory, '.env.local'), quiet: true });

/** Standalone experiment. Input must already have the target faces blurred.
 * The model may edit other pixels too; this is a visual demo, not masked compositing.
 * Returns the generated image path and preserves the input file.
 */
export async function generateFakeFaces(
  inputPath: string,
  outputDirectory = path.join(appDirectory, '..', 'reports', 'face-replacement'),
  model = 'gemini-2.5-flash-image',
): Promise<string> {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[path.extname(inputPath).toLowerCase()];
  if (!mimeType) throw new Error('Use a JPEG, PNG, or WebP image with faces already blurred.');
  const source = await readFile(inputPath);
  if (source.length > 15 * 1024 * 1024) throw new Error('Please use an input image smaller than 15 MiB.');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in your environment or application files/.env.local.');

  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } });
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType, data: source.toString('base64') } },
      { text: `Create an edited photograph with NEW, SHARP, fully visible fictional faces
in EVERY blurred face region. The blur is a placeholder to PAINT OVER, not an effect to preserve.
Invent new eyes, eyebrows, a nose, a mouth, and realistic skin detail for those regions.
Use ordinary adult human facial anatomy: naturally sized eyes, realistic iris proportions,
subtle asymmetry, visible skin texture, and the same photographic sharpness as the surroundings.
No illustration, animation, doll-like features, beauty-filter smoothing, or exaggerated eyes.
Keep the head outline, facial feature positions, head scale, and camera framing consistent.
This is synthetic character creation, NOT deblurring, identity recovery, or restoration.
Do not infer or reproduce the original identities. The replacements must visibly differ
from the blurred placeholders: no blur, smudges, pixelation, or featureless faces may remain.
Match the existing head angles, expressions, lighting, perspective, and photographic grain.
Keep already sharp faces unchanged. Preserve hair, clothing, bodies, background, and composition.
For a group portrait, replace each blurred person's face independently with a new fictional face.
Return the finished edited image. If you cannot make this edit, explain why instead of
returning an unchanged photograph.` },
    ] }],
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const modelText = parts.map(part => part.text ?? '').join('\n').trim();
  const result = parts.find(part => part.inlineData?.mimeType?.startsWith('image/') && part.inlineData.data)?.inlineData;
  if (!result?.data) {
    const explanation = parts.map(part => part.text ?? '').join(' ').trim();
    throw new Error(`The model returned no image. ${explanation || response.promptFeedback?.blockReason || 'Try another photograph or check model access.'}`);
  }
  const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
  const extension = extensions[result.mimeType ?? ''];
  if (!extension) throw new Error(`Unexpected image format: ${result.mimeType}`);
  // A separate run directory keeps repeated experiments and source files intact.
  const runDirectory = path.join(outputDirectory, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  await mkdir(runDirectory, { recursive: true });
  const outputPath = path.join(runDirectory, `ai-replacement${extension}`);
  await writeFile(outputPath, Buffer.from(result.data, 'base64'));
  await writeFile(path.join(runDirectory, `blurred-input${path.extname(inputPath)}`), source);
  await writeFile(path.join(runDirectory, 'experiment.json'), JSON.stringify({
    model, generatedAt: new Date().toISOString(), aiEdited: true, modelText,
    note: 'Experimental full-image edit. Review for unintended changes; identity protection is not validated.',
  }, null, 2));
  if (modelText) console.log(`Model response: ${modelText}`);
  return outputPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, model] = process.argv.slice(2);
  if (!input || input === '--help') {
    console.log('Usage: npx tsx scripts/test-face-replacement.ts "path/to/blurred-photo.jpg" [output-directory] [model]');
    console.log('Sends the supplied image to Gemini. Use a photo with the target faces already blurred.');
    if (!input) process.exitCode = 1;
  } else {
    generateFakeFaces(input, output, model)
      .then(result => console.log(`Saved AI-edited image: ${result}`))
      .catch(error => {
        // Avoid dumping SDK request objects, which can contain the photo or credentials.
        console.error(error instanceof Error ? error.message : 'Image generation failed.');
        process.exitCode = 1;
      });
  }
}
