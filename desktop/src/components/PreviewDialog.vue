<script setup lang="ts">
const api=window.teachshelf;
import {computed} from 'vue';
import Modal from './Modal.vue';
import {useLibrary} from '../stores/library';
const props=defineProps<{preview:{url:string;mime:string;name:string};id:string}>(),emit=defineEmits<{close:[]}>(),store=useLibrary();
const type=computed(()=>{const m=props.preview.mime;return m==='application/pdf'?'pdf':m.startsWith('image/')&&m!=='image/svg+xml'?'image':m.startsWith('video/')?'video':m.startsWith('audio/')?'audio':m==='text/plain'?'text':'other';});
</script>
<template><Modal :title="preview.name" wide @close="emit('close')"><div class="preview-stage"><img v-if="type==='image'" :src="preview.url" :alt="preview.name"/><video v-else-if="type==='video'" :src="preview.url" controls/><audio v-else-if="type==='audio'" :src="preview.url" controls/><iframe v-else-if="type==='pdf'||type==='text'" :src="preview.url" :title="preview.name" sandbox="allow-same-origin" referrerpolicy="no-referrer"/><div v-else class="empty-state"><p>此文件格式请使用系统应用预览。</p><button class="primary" @click="store.run(()=>api.openMaterial(id),'已打开资料')">使用系统应用打开</button></div></div></Modal></template>
