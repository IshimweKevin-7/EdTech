/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Chat, Part } from '@google/genai';
import { marked } from 'marked';
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.mjs';

// Required for pdf.js to work in a browser environment
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs';

// --- Interfaces ---
type Attachment = AttachedFile | AttachedDocument;

interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
  attachments?: Attachment[];
}

interface AttachedFile {
  type: 'file';
  id: string;
  name: string;
  base64: string;
  mimeType: string;
  sourceUrl: string;
}

interface AttachedDocument {
  type: 'doc';
  id: string;
  name: string;
  textContent: string;
  summary?: string;
  abortController?: AbortController;
}

// --- DOM Elements ---
const loginOverlay = document.getElementById('login-overlay') as HTMLElement;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const appLayout = document.getElementById('app-layout') as HTMLElement;
const headerUsername = document.getElementById('header-username') as HTMLSpanElement;
const newChatBtn = document.getElementById('new-chat-btn') as HTMLAnchorElement;
const downloadTxtBtn = document.getElementById('download-txt-btn') as HTMLAnchorElement;
const downloadJsonBtn = document.getElementById('download-json-btn') as HTMLAnchorElement;
const chatHistory = document.getElementById('chat-history') as HTMLElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const sendButton = chatForm.querySelector('button[type="submit"]') as HTMLButtonElement;
const imageUploadBtn = document.getElementById('image-upload-btn') as HTMLButtonElement;
const docUploadBtn = document.getElementById('doc-upload-btn') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const attachmentsContainer = document.getElementById('attachments-container') as HTMLElement;

// --- Gemini AI ---
let ai: GoogleGenAI;
let chat: Chat;

// --- App State ---
let currentChatHistory: ChatMessage[] = [];
let attachedFiles: AttachedFile[] = [];
let attachedDocs: AttachedDocument[] = [];

/**
 * Initializes the GoogleGenAI instance.
 */
function initializeAI() {
  try {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  } catch (error) {
     console.error('Failed to initialize AI:', error);
     addMessage(
      'ai',
      'Sorry, I could not connect to the AI service. Please check your API key and network connection.'
    );
    toggleChatForm(false);
  }
}

// --- Chat Functionality ---

function saveChatHistory() {
  localStorage.setItem('chatHistory', JSON.stringify(currentChatHistory));
}

function loadChatHistory(): ChatMessage[] {
  const storedHistory = localStorage.getItem('chatHistory');
  if (storedHistory) {
    try {
      return JSON.parse(storedHistory);
    } catch (e) {
      console.error("Failed to parse chat history from localStorage", e);
      return [];
    }
  }
  return [];
}


async function initializeChat() {
  if (!ai) return;
  
  chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: 'You are an AI learning companion for students. Your goal is to explain complex concepts in a clear, simple, and engaging way. Use analogies, real-world examples, and a consistently encouraging and patient tone. When asked a direct question from a test or homework, guide the user to the answer by explaining the underlying principles rather than providing the solution directly. Always encourage them to ask more questions. If the user provides an image or a document, analyze it and answer any questions they have about it.'
    }
  });

  currentChatHistory = loadChatHistory();
  chatHistory.innerHTML = '';

  if (currentChatHistory.length === 0) {
    const welcomeMessage = 'Hello! I\'m your EdTech assistant. How can I help you learn today? You can ask me to explain a concept, summarize a topic, or quiz you on a subject.';
    await addMessage('ai', welcomeMessage);
    currentChatHistory.push({ sender: 'ai', text: welcomeMessage });
    saveChatHistory();
  } else {
    for (const message of currentChatHistory) {
      await addMessage(message.sender, message.text, message.attachments);
    }
  }
}

async function addMessage(sender: 'user' | 'ai', text: string, attachments?: Attachment[]): Promise<HTMLElement> {
  const messageContainer = document.createElement('div');
  messageContainer.classList.add('message', sender);

  const bubble = document.createElement('div');
  bubble.classList.add('bubble');
  
  if (attachments && attachments.length > 0) {
    const attachmentsDiv = document.createElement('div');
    attachmentsDiv.className = 'message-attachments';
    for (const attachment of attachments) {
      if (attachment.type === 'file' && attachment.sourceUrl) {
        const imageElement = document.createElement('img');
        imageElement.src = attachment.sourceUrl;
        imageElement.alt = attachment.name;
        imageElement.className = 'attachment-image';
        attachmentsDiv.appendChild(imageElement);
      } else if (attachment.type === 'doc') {
        const docElement = document.createElement('div');
        docElement.className = 'attachment-doc';
        docElement.textContent = `Attached: ${attachment.name}`;
        attachmentsDiv.appendChild(docElement);
      }
    }
    bubble.appendChild(attachmentsDiv);
  }
  
  const textElement = document.createElement('div');
  if (text) {
    textElement.innerHTML = await marked.parse(text);
  }
  bubble.appendChild(textElement);

  messageContainer.appendChild(bubble);
  chatHistory.appendChild(messageContainer);
  if(chatHistory.parentElement) {
    chatHistory.parentElement.scrollTop = chatHistory.parentElement.scrollHeight;
  }

  return textElement;
}

function toggleChatForm(enabled: boolean) {
  chatInput.disabled = !enabled;
  sendButton.disabled = !enabled;
  imageUploadBtn.disabled = !enabled;
  docUploadBtn.disabled = !enabled;
}

async function handleChatFormSubmit(event: Event) {
  event.preventDefault();
  const userInput = chatInput.value.trim();
  const allAttachments: Attachment[] = [...attachedFiles, ...attachedDocs];

  if (!userInput && allAttachments.length === 0) return;
  if (!chat) {
    addMessage('ai', 'The chat is not initialized. Please wait or refresh the page.');
    return;
  }

  toggleChatForm(false);
  chatInput.value = '';

  const userMessage: ChatMessage = { sender: 'user', text: userInput, attachments: allAttachments };
  await addMessage('user', userMessage.text, userMessage.attachments);
  currentChatHistory.push(userMessage);
  saveChatHistory();

  const messageParts: Part[] = [];
  
  for (const file of attachedFiles) {
    messageParts.push({
      inlineData: { mimeType: file.mimeType, data: file.base64 }
    });
  }

  let promptText = userInput;
  if (attachedDocs.length > 0) {
    const docText = attachedDocs.map(d => `DOCUMENT: "${d.name}"\n\n${d.textContent}`).join('\n\n---\n\n');
    promptText = `${docText}\n\n---\n\nBased on the document(s) provided, please respond to the following: ${userInput}`;
  }
  if (promptText) {
    messageParts.push({ text: promptText });
  }
  
  attachedFiles = [];
  attachedDocs = [];
  renderAttachments();

  const loadingIndicatorHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  const aiMessageBubble = await addMessage('ai', loadingIndicatorHTML);
  let fullResponse = '';

  try {
    const responseStream = await chat.sendMessageStream({ message: messageParts });
    aiMessageBubble.innerHTML = ''; 
    for await (const chunk of responseStream) {
      fullResponse += chunk.text;
      aiMessageBubble.innerHTML = await marked.parse(fullResponse + '▌');
      if (chatHistory.parentElement) {
        chatHistory.parentElement.scrollTop = chatHistory.parentElement.scrollHeight;
      }
    }
    aiMessageBubble.innerHTML = await marked.parse(fullResponse);
    currentChatHistory.push({ sender: 'ai', text: fullResponse });
    saveChatHistory();
  } catch (error) {
    console.error('Error sending message:', error);
    aiMessageBubble.innerHTML = await marked.parse('Sorry, something went wrong. Please try again.');
  } finally {
    toggleChatForm(true);
    chatInput.focus();
    if (chatHistory.parentElement) {
      chatHistory.parentElement.scrollTop = chatHistory.parentElement.scrollHeight;
    }
  }
}

// --- File Handling ---

function handleImageUploadClick() {
  fileInput.accept = 'image/*';
  fileInput.click();
}

function handleDocUploadClick() {
  fileInput.accept = '.txt,.pdf';
  fileInput.click();
}

async function handleFileSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  if (!files) return;

  toggleChatForm(false);

  for (const file of files) {
    const fileId = `${file.name}-${Date.now()}`;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const sourceUrl = e.target?.result as string;
        const base64 = sourceUrl.split(',')[1];
        attachedFiles.push({ type: 'file', id: fileId, name: file.name, base64, mimeType: file.type, sourceUrl });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'text/plain' || file.type === 'application/pdf') {
        const abortController = new AbortController();
        const doc: AttachedDocument = { type: 'doc', id: fileId, name: file.name, textContent: '', abortController };
        attachedDocs.push(doc);
        renderAttachments(); // Render pill immediately
        
        const pill = document.getElementById(fileId);
        const nameEl = pill?.querySelector('.file-name');
        const progressEl = pill?.querySelector('.progress-bar');
        const progressInnerEl = progressEl?.querySelector('div');

        const updateProgress = (status: string, percentage?: number) => {
            if (!nameEl || !progressEl || !progressInnerEl) return;
            nameEl.textContent = status;
            if (percentage === undefined) {
                progressEl.classList.add('hidden');
                (progressInnerEl as HTMLElement).style.width = '0%';
            } else {
                progressEl.classList.remove('hidden');
                (progressInnerEl as HTMLElement).style.width = `${Math.max(0, Math.min(100, percentage))}%`;
            }
        };

        try {
            pill?.classList.add('processing');
            let textContent = '';
            if (file.type === 'text/plain') {
                updateProgress('Reading document...', 25);
                textContent = await file.text();
            } else if (file.type === 'application/pdf') {
                updateProgress('Reading document...', 5);
                const arrayBuffer = await file.arrayBuffer();
                updateProgress('Parsing PDF...', 15);
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, signal: abortController.signal }).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const percentage = 15 + (i / pdf.numPages) * 70;
                    updateProgress(`Extracting text (Page ${i} of ${pdf.numPages})...`, percentage);
                    const page = await pdf.getPage(i);
                    const pageText = await page.getTextContent({ signal: abortController.signal });
                    textContent += pageText.items.map(item => (item as any).str).join(' ');
                    textContent += '\n\n';
                }
            }
            doc.textContent = textContent;
            updateProgress(file.name);
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                console.log(`Processing of ${file.name} was canceled.`);
                return; // Gracefully exit on cancellation
            }
            console.error("Error processing document:", error);
            attachedDocs = attachedDocs.filter(d => d.id !== fileId); // Remove on failure
            pill?.classList.add('error');
            updateProgress('Error: Could not read file.');
        } finally {
            pill?.classList.remove('processing');
        }
    }
  }

  target.value = '';
  toggleChatForm(true);
  chatInput.focus();
}

function removeAttachment(id: string) {
    const isProcessing = document.getElementById(id)?.classList.contains('processing');

    // No confirmation needed to cancel an in-progress upload
    if (isProcessing || confirm('Are you sure you want to discard this file?')) {
        const docToCancel = attachedDocs.find(d => d.id === id);
        docToCancel?.abortController?.abort();

        attachedFiles = attachedFiles.filter(f => f.id !== id);
        attachedDocs = attachedDocs.filter(d => d.id !== id);
        renderAttachments();
    }
}

function renderAttachments() {
    attachmentsContainer.innerHTML = '';
    const allAttachments: (AttachedFile | AttachedDocument)[] = [...attachedFiles, ...attachedDocs];

    if (allAttachments.length === 0) {
        attachmentsContainer.classList.add('hidden');
        return;
    }
    attachmentsContainer.classList.remove('hidden');

    for (const attachment of allAttachments) {
        const pill = document.createElement('div');
        pill.className = 'attachment-pill';
        pill.id = attachment.id;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-attachment-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.setAttribute('aria-label', `Remove ${attachment.name}`);
        removeBtn.onclick = () => removeAttachment(attachment.id);

        if (attachment.type === 'file') {
            pill.classList.add('image-pill');
            const img = document.createElement('img');
            img.src = attachment.sourceUrl;
            img.alt = attachment.name;
            img.className = 'thumbnail';
            pill.appendChild(img);
        } else {
            pill.classList.add('doc-pill');
            pill.innerHTML = `
                <div class="file-icon-wrapper">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    <div class="spinner"></div>
                </div>
                <div class="file-details">
                    <span class="file-name">${attachment.name}</span>
                    <div class="progress-bar hidden"><div></div></div>
                </div>
            `;
        }
        pill.appendChild(removeBtn);
        attachmentsContainer.appendChild(pill);
    }
}

// --- Download ---
function downloadFile(filename: string, content: string, mimeType: string) {
    const a = document.createElement('a');
    const blob = new Blob([content], {type: mimeType});
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function handleDownloadTxt() {
    let textContent = `EdTech Chat History - ${new Date().toLocaleString()}\n\n`;
    currentChatHistory.forEach(message => {
        textContent += `[${message.sender.toUpperCase()}]\n`;
        if (message.attachments && message.attachments.length > 0) {
            message.attachments.forEach(att => {
                textContent += `Attached: ${att.name}\n`;
            });
        }
        textContent += `${message.text}\n\n`;
    });
    downloadFile('chat-history.txt', textContent, 'text/plain');
}

function handleDownloadJson() {
    const jsonContent = JSON.stringify(currentChatHistory, null, 2);
    downloadFile('chat-history.json', jsonContent, 'application/json');
}


// --- Auth & Session ---
function handleLogin(event: Event) {
  event.preventDefault();
  const username = usernameInput.value.trim();
  if (username) {
    localStorage.setItem('username', username);
    initializeApp(username);
  }
}

async function handleNewChat(event: Event) {
  event.preventDefault();
  currentChatHistory = [];
  attachedFiles = [];
  attachedDocs = [];
  renderAttachments();
  localStorage.removeItem('chatHistory');
  chatHistory.innerHTML = '';
  await initializeChat();
}

function showApp(username: string) {
  loginOverlay.classList.add('hidden');
  appLayout.classList.remove('hidden');
  headerUsername.textContent = username;
}

function showLogin() {
  loginOverlay.classList.remove('hidden');
  appLayout.classList.add('hidden');
  localStorage.removeItem('username');
  localStorage.removeItem('chatHistory');
}

function checkAuthentication() {
  const username = localStorage.getItem('username');
  if (username) {
    initializeApp(username);
  } else {
    showLogin();
  }
}

async function initializeApp(username: string) {
  showApp(username);
  initializeAI();
  await initializeChat();
  toggleChatForm(true);
  chatInput.focus();
}

// --- App Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
  chatForm.addEventListener('submit', handleChatFormSubmit);
  loginForm.addEventListener('submit', handleLogin);
  newChatBtn.addEventListener('click', handleNewChat);
  imageUploadBtn.addEventListener('click', handleImageUploadClick);
  docUploadBtn.addEventListener('click', handleDocUploadClick);
  fileInput.addEventListener('change', handleFileSelected);
  downloadTxtBtn.addEventListener('click', handleDownloadTxt);
  downloadJsonBtn.addEventListener('click', handleDownloadJson);

  checkAuthentication();
});