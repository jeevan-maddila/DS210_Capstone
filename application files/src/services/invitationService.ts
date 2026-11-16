import { auth } from '../lib/firebase';

interface CreateInvitationResponse {
  success: true;
  message: string;
  email: string;
  invitation: {
    id: string;
    email: string;
    status: 'pending';
    expiresAt: string;
  };
}

export interface AcceptInvitationResponse {
  success: true;
  message: string;
  eventId: string;
  email: string;
}

async function authenticatedRequest<T>(path: string, options: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in to continue.');
  }

  const idToken = await user.getIdToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...options.headers
    }
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || 'The invitation request failed. Please try again.');
  }

  return result as T;
}

export const invitationService = {
  create(eventId: string, email: string): Promise<CreateInvitationResponse> {
    return authenticatedRequest('/api/photographer-invitations', {
      method: 'POST',
      body: JSON.stringify({ eventId, email })
    });
  },

  accept(token: string): Promise<AcceptInvitationResponse> {
    return authenticatedRequest('/api/photographer-invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
  }
};
