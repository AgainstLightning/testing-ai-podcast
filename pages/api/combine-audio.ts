import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import os from 'os';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegPath || '/usr/bin/ffmpeg');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { lines } = req.body;

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).send('Invalid input');
    return;
  }

  try {
    // Generate audio files for each line
    const audioBuffers = await Promise.all(lines.map((line: string) => synthesizeSpeech(line)));

    // Combine audio files
    const combinedAudioPath = await combineAudioBuffers(audioBuffers);

    // Send the combined audio file
    res.setHeader('Content-Type', 'audio/mpeg');
    const stream = fs.createReadStream(combinedAudioPath);
    stream.pipe(res);

    // Clean up after response is sent
    stream.on('close', () => {
      fs.unlinkSync(combinedAudioPath);
    });
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).send('An error occurred while processing audio');
  }
}

async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = 'YOUR_VOICE_ID'; // Replace with your desired voice ID

  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const headers = {
    'Content-Type': 'application/json',
    'xi-api-key': apiKey,
    Accept: 'audio/mpeg',
  };
  const data = {
    text,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  };

  const response = await axios.post(url, data, {
    headers,
    responseType: 'arraybuffer',
  });

  return Buffer.from(response.data);
}

async function combineAudioBuffers(audioBuffers: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const tempFiles: string[] = [];

    // Write buffers to temp files
    audioBuffers.forEach((buffer, index) => {
      const tempFilePath = path.join(tempDir, `audio_${index}.mp3`);
      fs.writeFileSync(tempFilePath, buffer);
      tempFiles.push(tempFilePath);
    });

    const outputFilePath = path.join(tempDir, `combined_${Date.now()}.mp3`);

    let command = ffmpeg();

    tempFiles.forEach((filePath) => {
      command = command.input(filePath);
    });

    command
      .on('error', (err) => {
        // Clean up temp files
        tempFiles.forEach((file) => fs.unlinkSync(file));
        reject(err);
      })
      .on('end', () => {
        // Clean up temp files
        tempFiles.forEach((file) => fs.unlinkSync(file));
        resolve(outputFilePath);
      })
      .mergeToFile(outputFilePath);
  });
}

