<script setup lang="ts">
const api=window.teachshelf;
import {computed,reactive} from 'vue';
import type {MaterialFolder} from '../../shared/model';
import {useLibrary} from '../stores/library';
import Modal from './Modal.vue';
const props=defineProps<{folder?:MaterialFolder}>(),emit=defineEmits<{close:[]}>(),store=useLibrary();
const form=reactive({name:props.folder?.name??'',courseID:props.folder?.courseID??store.courseID??'',parentID:props.folder?.parentID??(props.folder?'':store.folderID??''),colorHex:props.folder?.colorHex??'#39786B'});
const parents=computed(()=>store.state.materialFolders.filter(f=>f.courseID===(form.courseID||undefined)&&f.id!==props.folder?.id&&!f.isMissing));
async function save(){const input={name:form.name,courseID:form.courseID||undefined,parentID:form.parentID||undefined};const result=await store.change(()=>props.folder?api.updateFolder(props.folder.id,{...input,colorHex:form.colorHex}):api.createFolder(input),'文件夹已保存');if(result)emit('close');}
async function dissolve(){if(!props.folder||!await store.confirm('解散文件夹？','文件夹及所有子文件夹的分组会解除，资料会移回上一级，实际文件保留。','解散文件夹'))return;const result=await store.change(()=>api.dissolveFolder(props.folder!.id),'文件夹已解散');if(result){if(store.folderID===props.folder.id)store.folderID=props.folder.parentID;emit('close');}}
</script>
<template><Modal :title="folder?'编辑文件夹':'新建文件夹'" @close="emit('close')"><form class="form-stack" @submit.prevent="save"><label>名称<input v-model="form.name" required maxlength="120"/></label><label>课程<select aria-label="课程" v-model="form.courseID" @change="form.parentID=''"><option value="">未分类</option><option v-for="c in store.state.courses" :value="c.id" :key="c.id">{{c.name}}</option></select></label><label>上级文件夹<select aria-label="上级文件夹" v-model="form.parentID"><option value="">资料根目录</option><option v-for="f in parents" :value="f.id" :key="f.id">{{f.name}}</option></select></label><label v-if="folder" class="color-field">颜色<input type="color" v-model="form.colorHex"/></label><div class="dialog-actions"><button v-if="folder" type="button" class="danger-text" @click="dissolve">解散文件夹</button><span class="spacer"/><button type="button" @click="emit('close')">取消</button><button class="primary" :disabled="!form.name.trim()||!!store.busy">保存</button></div></form></Modal></template>
