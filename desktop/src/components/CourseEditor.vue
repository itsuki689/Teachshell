<script setup lang="ts">
const api=window.teachshelf;
import {reactive} from 'vue';
import type {Course} from '../../shared/model';
import {useLibrary} from '../stores/library';
import Modal from './Modal.vue';
const props=defineProps<{course?:Course}>();const emit=defineEmits<{close:[]}>();const store=useLibrary();
const form=reactive({name:props.course?.name??'',semester:props.course?.semester??'',teacher:props.course?.teacher??'',colorHex:props.course?.colorHex??'#39786B'});
async function save(){const value=await store.change(()=>props.course?api.updateCourse(props.course.id,{...form}):api.createCourse({...form}),'课程已保存');if(value){if(!props.course){const c=value.state.courses.at(-1);if(c)store.navigate('course:'+c.id);}emit('close');}}
async function archive(){if(!props.course)return;const value=await store.change(()=>api.updateCourse(props.course!.id,{isArchived:!props.course!.isArchived}),'课程归档状态已更新');if(value)emit('close');}
async function remove(){if(!props.course)return;if(!await store.confirm('删除课程？','课程资料会保留并移至未分类，关联计划也会保留。此操作会解除文件夹分组及教学网站连接。','删除课程'))return;const value=await store.change(()=>api.deleteCourse(props.course!.id),'课程已删除，资料已保留');if(value)emit('close');}
</script>
<template><Modal :title="course?'编辑课程':'新建课程'" @close="emit('close')"><form class="form-stack" @submit.prevent="save"><label>课程名称<input v-model="form.name" required maxlength="500" placeholder="例如：高等数学" autofocus/></label><div class="form-row"><label>学期<input v-model="form.semester" placeholder="2026 秋季"/></label><label>教师<input v-model="form.teacher" placeholder="教师姓名"/></label></div><label class="color-field">课程颜色<input type="color" v-model="form.colorHex"/></label><div class="dialog-actions"><template v-if="course"><button type="button" class="danger-text" @click="remove">删除课程</button><button type="button" @click="archive">{{course.isArchived?'恢复课程':'归档课程'}}</button></template><span class="spacer"/><button type="button" @click="emit('close')">取消</button><button class="primary" :disabled="!form.name.trim()||!!store.busy">保存</button></div></form></Modal></template>
