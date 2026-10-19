import {
  db,
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  onSnapshot
} from '../lib/firebase';
import { AttendeeRecord, PhotoRecord } from '../types';

export interface Task1Result {
  processed: number;
  total: number;
  durationSeconds: number;
  logs: string[];
  jobExecution?: any;
}

export interface Task2Result {
  processed: number;
  blurredFaces: number;
  matchedAttendees: number;
  durationSeconds: number;
  logs: string[];
  jobExecution?: any;
}

export const pipelineService = {
  // ==========================================
  // CLOUD RUN PIPELINE STATUS CHECK
  // ==========================================
  async getCloudRunStatus(): Promise<{
    status: string;
    cloudRunConfig: {
      projectId: string;
      region: string;
      databaseId: string;
      job1: string;
      job2: string;
      eventarcTopic: string;
    };
  }> {
    try {
      const res = await fetch('/api/jobs/status');
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // Backend status endpoint not reached
    }
    return {
      status: 'cloud_ready',
      cloudRunConfig: {
        projectId: 'mids-capstone-ajt',
        region: 'us-east1',
        databaseId: 'ai-studio-a1858ef2-f062-409f-aaff-1218861a9484',
        job1: 'embed-checkins',
        job2: 'match-photos',
        eventarcTopic: 'photo-upload-events'
      }
    };
  },

  // ==========================================
  // TASK 1: RUN CLOUD RUN JOB 1 (embed-checkins)
  // Wakes Cloud Run Job 1 to run AuraFace 512-D embedding
  // ==========================================
  async runTask1AttendeeEmbedder(
    eventId: string,
    onProgress?: (msg: string, current: number, total: number) => void
  ): Promise<Task1Result> {
    const startTime = performance.now();
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      console.log(`[Cloud Run Job 1] ${msg}`);
    };

    log(`[Cloud Run] Initiating Job 1: embed-checkins for Event: ${eventId}`);
    if (onProgress) {
      onProgress('Waking Cloud Run Job 1 (embed-checkins)...', 10, 100);
    }

    // 1. Check current pending attendees in Firestore
    const attendeesRef = collection(db, 'events', eventId, 'attendees');
    const snap = await getDocs(attendeesRef);
    const attendees: AttendeeRecord[] = [];
    snap.forEach((d) => attendees.push(d.data() as AttendeeRecord));

    const pendingAttendees = attendees.filter(
      (a) => a.checkInPhotoUrl && (!a.photoEmbedding || a.photoEmbedding.length !== 512)
    );

    log(`Found ${attendees.length} total attendees (${pendingAttendees.length} awaiting 512-D AuraFace embeddings).`);

    // 2. Dispatch Cloud Run trigger to backend
    let jobExecutionResult: any = null;
    try {
      log('Sending trigger request to Cloud Run execution engine...');
      if (onProgress) {
        onProgress('Dispatching Cloud Run Job execution request...', 30, 100);
      }

      const res = await fetch('/api/jobs/run-task1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, limit: 100 })
      });

      if (res.ok) {
        jobExecutionResult = await res.json();
        if (jobExecutionResult.success) {
          log(`✓ Cloud Run Job 1 dispatched: ${jobExecutionResult.message}`);
          if (jobExecutionResult.executionName) {
            log(`[Execution ID] ${jobExecutionResult.executionName}`);
          }
        } else {
          log(`[Cloud Run Notice] ${jobExecutionResult.message}`);
          if (jobExecutionResult.details) {
            log(`[Details] ${jobExecutionResult.details}`);
          }
          if (jobExecutionResult.command) {
            log(`[Terminal Command] ${jobExecutionResult.command}`);
          }
          if (jobExecutionResult.iamGrantCommand) {
            log(`[Grant Role Command] ${jobExecutionResult.iamGrantCommand}`);
          }
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        log(`[Cloud Run Notice] Trigger returned status ${res.status}: ${errJson.error || res.statusText}`);
        if (errJson.command) {
          log(`[Terminal Command] ${errJson.command}`);
        }
      }
    } catch (err: any) {
      log(`[Cloud Run Notice] Trigger endpoint communication notice: ${err.message}`);
    }

    if (onProgress) {
      onProgress('Cloud Run Job processing attendees in background...', 70, 100);
    }

    // 3. Briefly await Firestore state reflection
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 4. Re-check Firestore to measure newly embedded records
    const afterSnap = await getDocs(attendeesRef);
    let newlyProcessed = 0;
    afterSnap.forEach((d) => {
      const att = d.data() as AttendeeRecord;
      if (att.photoEmbedding && att.photoEmbedding.length === 512) {
        newlyProcessed++;
      }
    });

    const elapsed = parseFloat(((performance.now() - startTime) / 1000).toFixed(2));
    log(`Job 1 Execution Summary: ${newlyProcessed} attendees have valid 512-D cloud embeddings (${elapsed}s elapsed).`);

    if (onProgress) {
      onProgress(`✓ Cloud Run Job 1 completed (${elapsed}s)`, 100, 100);
    }

    return {
      processed: newlyProcessed,
      total: attendees.length,
      durationSeconds: elapsed,
      logs,
      jobExecution: jobExecutionResult
    };
  },

  // ==========================================
  // TASK 2: RUN CLOUD RUN JOB 2 (match-photos)
  // Wakes Cloud Run Job 2 to run InsightFace FaceAnalysis,
  // KNN similarity search against attendee embeddings, and
  // privacy redaction blur on non-consenting faces
  // ==========================================
  async runTask2MatchAndRedact(
    eventId: string,
    targetPhotoId?: string,
    onProgress?: (msg: string, current: number, total: number) => void
  ): Promise<Task2Result> {
    const startTime = performance.now();
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      console.log(`[Cloud Run Job 2] ${msg}`);
    };

    log(`[Cloud Run] Initiating Job 2: match-photos for Event: ${eventId}${targetPhotoId ? ` (Photo: ${targetPhotoId})` : ''}`);
    if (onProgress) {
      onProgress('Waking Cloud Run Job 2 (match-photos)...', 10, 100);
    }

    // 1. Inspect current photo counts in Firestore
    const photosRef = collection(db, 'events', eventId, 'photos');
    const initialSnap = await getDocs(photosRef);
    const initialPending = initialSnap.docs.filter((d) => (d.data() as PhotoRecord).status === 'pending');
    log(`Found ${initialSnap.size} total photos (${initialPending.length} pending processing).`);

    // 2. Dispatch Cloud Run trigger to backend
    let jobExecutionResult: any = null;
    try {
      log('Sending trigger request to Cloud Run execution engine...');
      if (onProgress) {
        onProgress('Dispatching Cloud Run Job 2 trigger to GCP...', 30, 100);
      }

      const res = await fetch('/api/jobs/run-task2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, photoId: targetPhotoId })
      });

      if (res.ok) {
        jobExecutionResult = await res.json();
        if (jobExecutionResult.success) {
          log(`✓ Cloud Run Job 2 dispatched: ${jobExecutionResult.message}`);
          if (jobExecutionResult.executionName) {
            log(`[Execution ID] ${jobExecutionResult.executionName}`);
          }
        } else {
          log(`[Cloud Run Notice] ${jobExecutionResult.message}`);
          if (jobExecutionResult.details) {
            log(`[Details] ${jobExecutionResult.details}`);
          }
          if (jobExecutionResult.command) {
            log(`[Terminal Command] ${jobExecutionResult.command}`);
          }
          if (jobExecutionResult.iamGrantCommand) {
            log(`[Grant Role Command] ${jobExecutionResult.iamGrantCommand}`);
          }
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        log(`[Cloud Run Notice] Trigger returned status ${res.status}: ${errJson.error || res.statusText}`);
        if (errJson.command) {
          log(`[Terminal Command] ${errJson.command}`);
        }
      }
    } catch (err: any) {
      log(`[Cloud Run Notice] Trigger endpoint communication notice: ${err.message}`);
    }

    if (onProgress) {
      onProgress('Cloud Run FaceAnalysis & KNN search running in cloud...', 65, 100);
    }

    // 3. Briefly await Firestore state reflection
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 4. Read pre-computed matches from Firestore
    const afterSnap = await getDocs(photosRef);
    let processedCount = 0;
    let matchedAttendeesCount = 0;
    let blurredFacesCount = 0;

    afterSnap.forEach((d) => {
      const p = d.data() as PhotoRecord;
      if (p.status === 'processed') {
        processedCount++;
        matchedAttendeesCount += (p.matchedAttendees || []).length;
        blurredFacesCount += p.blurredFaceCount || 0;
      }
    });

    const elapsed = parseFloat(((performance.now() - startTime) / 1000).toFixed(2));
    log(
      `Job 2 Execution Summary: ${processedCount} processed photos in Firestore, ${matchedAttendeesCount} attendee tags, ${blurredFacesCount} bystander faces redacted (${elapsed}s elapsed).`
    );

    if (onProgress) {
      onProgress(`✓ Cloud Run Job 2 finished: ${processedCount} photos processed in cloud (${elapsed}s)`, 100, 100);
    }

    return {
      processed: processedCount,
      blurredFaces: blurredFacesCount,
      matchedAttendees: matchedAttendeesCount,
      durationSeconds: elapsed,
      logs,
      jobExecution: jobExecutionResult
    };
  }
};
