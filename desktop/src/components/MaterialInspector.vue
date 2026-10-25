<script setup lang="ts">
const api=window.teachshelf;
import {computed,nextTick,reactive,ref,watch} from 'vue';
import {ExternalLink,FolderOpen,Save,Star,X} from 'lucide-vue-next';
import {dateMs} from '../../shared/model';
import type {Material} from '../../shared/model';
import {useLibrary} from '../stores/library';
const props=defineProps<{material:Material}>(),emit=defineEmits<{close:[];preview:[id:string]}>(),store=useLibrary();
const form=reactive({title:'',category:'',tags:'',notes:'',filename:''}),initial=ref('');
function reset(){Object.assign(form,{title:props.material.title,category:props.material.category,tags:props.material.tags,notes:props.material.notes,filename:props.material.originalName});initial.value=JSON.stringify(form);}
watch(()=>props.material.id,reset,{immediate:true});
const dirty=computed(()=>JSON.stringify(form)!==initial.value);
watch(()=>props.material,()=>{if(!dirty.value)reset();},{deep:true});
async function save(){
 const baseline=JSON.parse(initial.value) as typeof form;
 const patch:Partial<Material>&{filename?:string}={},expected:Partial<Material>&{filename?:string}={};
 for(const key of ['title','category','tags','notes','filename'] as const){if(form[key]!==baseline[key]){patch[key]=form[key];expected[key]=baseline[key];}}
 const result=await store.change(()=>api.updateMaterial(props.material.id,patch,expected),'资料信息已保存');
 if(result){await nextTick();reset();}
}
const size=computed(()=>props.material.size<1024?props.material.size+' B':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(props.material.size/1024)+' KB');
</script>
<template><aside class="inspector"><header><h3>资料信息</h3><button class="icon-button" aria-label="关闭资料信息" @click="emit('close')"><X :size="17"/></button></header><div class="inspector-main"><div class="file-badge large">{{material.originalName.split('.').at(-1)?.toUpperCase().slice(0,6)||'FILE'}}</div><h3 class="wrap">{{material.title}}</h3><p class="muted small wrap">{{material.originalName}}</p><div v-if="material.isMissing" class="warning-banner">文件缺失；索引与备注已保留。</div><div class="inspector-actions"><button @click="emit('preview',material.id)" :disabled="material.isMissing">预览</button><button class="icon-button" title="使用系统应用打开" aria-label="使用系统应用打开" @click="store.run(()=>api.openMaterial(material.id),'已打开资料')" :disabled="material.isMissing"><ExternalLink :size="17"/></button><button class="icon-button" title="在文件管理器中显示" aria-label="在文件管理器中显示" @click="store.run(()=>api.revealMaterial(material.id),'已显示资料位置')" :disabled="material.isMissing"><FolderOpen :size="17"/></button><button class="icon-button" :class="{favorite:material.isFavorite}" :aria-label="material.isFavorite?'取消收藏':'收藏'" @click="store.change(()=>api.updateMaterial(material.id,{isFavorite:!material.isFavorite}),'收藏已更新')"><Star :size="17" :fill="material.isFavorite?'currentColor':'none'"/></button></div><form class="form-stack" @submit.prevent="save"><label>显示标题<input v-model="form.title" required/></label><label>实际文件名<input v-model="form.filename" :disabled="!material.isManaged" required/><small class="field-note">{{material.isManaged?'改名时须保留扩展名。':'外部引用保留原文件名。'}}</small></label><label>类别<input v-model="form.category" required/></label><label>标签<input v-model="form.tags" placeholder="例如：重点、期末复习"/></label><label>备注<textarea v-model="form.notes" rows="5" placeholder="记录阅读笔记…"/></label><div v-if="dirty" class="dialog-actions"><button type="button" @click="reset">还原</button><button class="primary" :disabled="!!store.busy||!form.title.trim()||!form.category.trim()"><Save :size="14"/>保存</button></div></form><dl class="metadata"><dt>存储方式</dt><dd>{{material.isManaged?'库内副本':'外部引用'}}</dd><dt>大小</dt><dd>{{size}}</dd><dt>添加日期</dt><dd>{{new Date(dateMs(material.addedAt)).toLocaleDateString('zh-CN')}}</dd><dt>文件位置</dt><dd class="wrap">{{material.storedPath}}</dd></dl></div></aside></template>
