<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchApi } from './api/client'

interface PingResult {
  status: string
  message: string
  version: string
}

const backendStatus = ref<string>('Đang kiểm tra kết nối Backend...')
const backendData = ref<PingResult | null>(null)
const isConnected = ref<boolean>(false)

async function checkBackend() {
  try {
    backendStatus.value = 'Đang gọi /api/ping...'
    const data = await fetchApi<PingResult>('/api/ping')
    backendData.value = data
    isConnected.value = true
    backendStatus.value = 'Kết nối Backend Goravel thành công!'
  } catch (error: any) {
    isConnected.value = false
    backendStatus.value = `Chưa kết nối được Backend (Hãy đảm bảo bạn đã khởi động Goravel ở cổng 3000): ${error.message}`
  }
}

onMounted(() => {
  checkBackend()
})
</script>

<template>
  <div class="container">
    <header class="card">
      <h1>🚀 Ponta Drive Web</h1>
      <p class="subtitle">Vue 3 (Vite + TypeScript) + Goravel (Go Backend)</p>
    </header>

    <main class="card">
      <h2>Trạng thái kết nối API</h2>
      <div :class="['status-badge', isConnected ? 'online' : 'offline']">
        {{ backendStatus }}
      </div>

      <div v-if="backendData" class="data-box">
        <p><strong>Status:</strong> {{ backendData.status }}</p>
        <p><strong>Message:</strong> {{ backendData.message }}</p>
        <p><strong>Goravel Version:</strong> {{ backendData.version }}</p>
      </div>

      <button class="btn" @click="checkBackend">Kiểm tra lại kết nối</button>
    </main>
  </div>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 40px auto;
  font-family: system-ui, -apple-system, sans-serif;
  padding: 0 16px;
}

.card {
  background: #ffffff;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  border: 1px solid #eaeaea;
}

h1 {
  margin: 0 0 8px 0;
  color: #1a1a1a;
}

h2 {
  margin-top: 0;
  font-size: 1.25rem;
  color: #333;
}

.subtitle {
  margin: 0;
  color: #666;
  font-size: 0.95rem;
}

.status-badge {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.95rem;
  margin: 16px 0;
  line-height: 1.4;
}

.status-badge.online {
  background-color: #e6f9ed;
  color: #0e7039;
  border: 1px solid #b7ebd0;
}

.status-badge.offline {
  background-color: #fff1f0;
  color: #cf1322;
  border: 1px solid #ffa39e;
}

.data-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-family: monospace;
  font-size: 0.9rem;
}

.data-box p {
  margin: 6px 0;
}

.btn {
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn:hover {
  background: #1d4ed8;
}
</style>
