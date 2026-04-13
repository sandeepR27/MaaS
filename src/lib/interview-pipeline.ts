import Daily from '@daily-co/daily-js';
// Removed Deepgram import due to type collision in v5 SDK
// import { CartesiaClient } from 'cartesia'; // Placeholder
import { GoogleGenerativeAI } from '@google/generative-ai';
import { InterviewState } from './interview-state';
import { InterviewLogic } from './interview-logic';    

export class InterviewPipeline {
  private interviewId: string;
  private interviewState: InterviewState;
  private interviewLogic: InterviewLogic;
  private call: any = null; // Daily instance
  private deepgram: any;
  // private cartesia: CartesiaClient;
  private gemini: GoogleGenerativeAI;
  private isRunning = false;

  constructor(interviewId: string, interviewState: InterviewState) {
    this.interviewId = interviewId;
    this.interviewState = interviewState;
    this.interviewLogic = new InterviewLogic(interviewState);

    // Initialize clients
    this.deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY!);
    // this.cartesia = new CartesiaClient({ apiKey: process.env.CARTESIA_API_KEY! });
    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  async start(): Promise<void> {
    try {
      console.log(`Starting interview pipeline for ${this.interviewId}`);

      // Create Daily call
      this.call = Daily.create({
        url: this.interviewState.meetingUrl,
        token: null, // Will be set when bot joins
      });

      // Set up event handlers
      this.call.on('joined-meeting', this.onJoinedMeeting.bind(this));
      this.call.on('participant-joined', this.onParticipantJoined.bind(this));
      this.call.on('transcription', this.onTranscription.bind(this));

      // Join the meeting
      await this.call.join();

      this.isRunning = true;
      console.log(`Interview pipeline started for ${this.interviewId}`);
    } catch (error) {
      console.error(`Failed to start interview pipeline: ${error}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.call && this.isRunning) {
      await this.call.leave();
      this.isRunning = false;
      console.log(`Interview pipeline stopped for ${this.interviewId}`);
    }
  }

  private onJoinedMeeting(): void {
    console.log('Bot joined the meeting');
    // Start transcription
    this.call?.startTranscription();
  }

  private onParticipantJoined(participant: { participantId: string }): void {
    console.log(`Participant joined: ${participant.participantId}`);
    // Could send welcome message
  }

  private async onTranscription(transcription: { transcript: string; participantId: string }): Promise<void> {
    if (!this.isRunning) return;

    try {
      const transcriptText = transcription.transcript;
      const speaker = transcription.participantId;
      const timestamp = Date.now();

      if (!transcriptText.trim()) return;

      // Create transcript entry (not used for now)
      // const transcriptEntry: TranscriptEntry = {
      //   id: crypto.randomUUID(),
      //   speaker,
      //   text: transcriptText,
      //   timestamp,
      //   createdAt: new Date(),
      // };

      // Add to conversation history
      this.interviewState.conversationHistory.push({
        role: speaker === 'bot' ? 'assistant' : 'user',
        text: transcriptText,
        timestamp,
      });

      // Process through interview logic
      const response = await this.interviewLogic.processResponse(transcriptText);

      if (response) {
        await this.sendResponse(response);
      }
    } catch (error) {
      console.error(`Error processing transcription: ${error}`);
    }
  }

  private async sendResponse(responseText: string): Promise<void> {
    if (!this.isRunning || !this.call) {
      console.warn(`Cannot send response; pipeline is not running for ${this.interviewId}`);
      return;
    }

    this.interviewState.conversationHistory.push({
      role: 'assistant',
      text: responseText,
      timestamp: Date.now(),
    });

    console.log(`Sending AI response for interview ${this.interviewId}: ${responseText}`);

    // Placeholder for TTS - in real implementation, use Cartesia or other TTS
    // const ttsResponse = await this.cartesia.tts.generate({
    //   model: 'sonic-english',
    //   voice: '12345678-1234-5678-9012-123456789012',
    //   text: responseText,
    // });

    // For now, just log
    console.log('TTS audio would be sent here');

    // await this.call.sendAudioData(ttsResponse.audio);
  }
}