import { NextRequest, NextResponse } from 'next/server';
import { InterviewPipeline } from '@/lib/interview-pipeline';
import { getInterviewState, setInterviewState } from '@/lib/interview-state';
import { withErrorHandler } from '@/lib/error-handler';
import { loggingMiddleware } from '@/lib/logging';
import { rateLimitMiddleware } from '@/lib/rate-limit';

export const POST = withErrorHandler(
  rateLimitMiddleware(
    loggingMiddleware(async (request: NextRequest) => {
      const body = await request.json();
      const { interviewId, meetingUrl } = body;

      if (!interviewId || !meetingUrl) {
        return NextResponse.json(
          { error: 'interviewId and meetingUrl are required' },
          { status: 400 }
        );
      }

      const interviewState = getInterviewState(interviewId);
      if (!interviewState) {
        return NextResponse.json(
          { error: 'Interview state not found' },
          { status: 404 }
        );
      }

      // Update meeting URL
      interviewState.meetingUrl = meetingUrl;
      setInterviewState(interviewId, interviewState);

      // Start the pipeline
      const pipeline = new InterviewPipeline(interviewId, interviewState);
      await pipeline.start();

      // Store the pipeline instance (in a real app, use a proper store)
      // For now, just start it

      return NextResponse.json({ status: 'Pipeline started' });
    })
  )
);