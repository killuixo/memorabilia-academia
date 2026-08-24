import React, { useState } from 'react';export default function App() {// COLOQUE AQUI A URL GERADA PELO GOOGLE APPS SCRIPTconst GOOGLE_SCRIPT_URL = 'SUA_URL_DO_GOOGLE_APPS_SCRIPT_AQUI';const [formData, setFormData] = useState({pacote: '',estudante: '',curso: '',ano: '',codigo: '125.31 / 125.43', // Sugestão padrão baseada no plano IFESobservacoes: ''});const [status, setStatus] = useState({ tipo: '', mensagem: '' });const [historico, setHistorico] = useState([]);const handleChange = (e) => {setFormData({ ...formData, [e.target.name]: e.target.value });};const handleSubmit = async (e) => {e.preventDefault();setStatus({ tipo: 'loading', mensagem: 'Registrando documento...' });try {
  // Usamos no-cors para evitar bloqueios do Google Sheets
  await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData)
  });

  setStatus({ tipo: 'success', mensagem: 'Pacote registrado com sucesso na planilha!' });
  
  // Adiciona ao histórico local (apenas visual)
  setHistorico([formData, ...historico]);
  
  // Limpa o formulário, mantendo o código padrão
  setFormData({
    pacote: '',
    estudante: '',
    curso: '',
    ano: '',
    codigo: '125.31 / 125.43',
    observacoes: ''
  });

  // Limpa a mensagem de sucesso após 3 segundos
  setTimeout(() => setStatus({ tipo: '', mensagem: '' }), 3000);

} catch (error) {
  setStatus({ tipo: 'error', mensagem: 'Erro ao conectar com a planilha. Verifique a URL.' });
}
};return (  {/* Container Principal - Estilo Mondrian com bordas grossas e grid */}
  <div className="max-w-5xl w-full bg-black border-8 border-black grid grid-cols-1 md:grid-cols-12 gap-2 shadow-[12px_12px_0px_rgba(0,0,0,1)]">
    
    {/* Cabeçalho - Pink Escuro */}
    <div className="md:col-span-12 bg-[#c21e56] p-6 flex flex-col justify-center items-start">
      <h1 className="text-4xl md:text-5xl font-black text-white uppercase tracking-tighter">
        Triagem MEN
      </h1>
      <p className="text-white font-bold text-lg mt-1 tracking-wide">
        Verificação e Remanejamento de Relatórios de Estágio
      </p>
    </div>

    {/* Formulário - Fundo Branco */}
    <div className="md:col-span-8 bg-white p-6 md:p-8">
      <h2 className="text-2xl font-bold mb-6 border-b-4 border-black pb-2 inline-block">Registrar Pacote</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col">
            <label className="font-bold mb-1">ID do Pacote / Maço</label>
            <input 
              type="text" 
              name="pacote"
              required
              value={formData.pacote} 
              onChange={handleChange}
              className="border-4 border-black p-2 focus:outline-none focus:bg-gray-100 transition-colors"
              placeholder="Ex: Pct 01, Maço A..."
            />
          </div>
          <div className="flex flex-col">
            <label className="font-bold mb-1">Curso de Licenciatura</label>
            <input 
              type="text" 
              name="curso"
              required
              value={formData.curso} 
              onChange={handleChange}
              className="border-4 border-black p-2 focus:outline-none focus:bg-gray-100 transition-colors"
              placeholder="Ex: História, Letras..."
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col">
            <label className="font-bold mb-1">Nome do Estudante (Opcional)</label>
            <input 
              type="text" 
              name="estudante"
              value={formData.estudante} 
              onChange={handleChange}
              className="border-4 border-black p-2 focus:outline-none focus:bg-gray-100 transition-colors"
              placeholder="Vários alunos / Nome"
            />
          </div>
          <div className="flex flex-col">
            <label className="font-bold mb-1">Semestre / Ano</label>
            <input 
              type="text" 
              name="ano"
              required
              value={formData.ano} 
              onChange={handleChange}
              className="border-4 border-black p-2 focus:outline-none focus:bg-gray-100 transition-colors"
              placeholder="Ex: 2021.2"
            />
          </div>
        </div>

        <div className="flex flex-col">
          <label className="font-bold mb-1">Código Arquivístico (SIGA/IFES)</label>
          <input 
            type="text" 
            name="codigo"
            value={formData.codigo} 
            onChange={handleChange}
            className="border-4 border-black p-2 focus:outline-none focus:bg-gray-100 transition-colors"
          />
        </div>

        <div className="flex flex-col">
          <label className="font-bold mb-1">Observações</label>
          <textarea 
            name="observacoes"
            value={formData.observacoes} 
            onChange={handleChange}
            rows="3"
            className="border-4 border-black p-2 focus:outline-none focus:bg-gray-100 transition-colors resize-none"
            placeholder="Ex: Faltam assinaturas, capa danificada..."
          ></textarea>
        </div>

        {/* Status da Submissão */}
        {status.mensagem && (
          <div className={`p-3 border-4 border-black font-bold ${
            status.tipo === 'error' ? 'bg-red-500 text-white' : 
            status.tipo === 'loading' ? 'bg-gray-300' : 'bg-green-400'
          }`}>
            {status.mensagem}
          </div>
        )}

        {/* Botão de Enviar - Dourado Escuro */}
        <button 
          type="submit" 
          disabled={status.tipo === 'loading'}
          className="w-full bg-[#b8860b] text-white font-black text-xl border-4 border-black p-4 uppercase tracking-widest hover:bg-yellow-600 hover:translate-y-1 transition-all active:translate-y-2"
        >
          Registrar na Planilha
        </button>
      </form>
    </div>

    {/* Painel Lateral - Ciano */}
    <div className="md:col-span-4 bg-[#00bcd4] p-6 flex flex-col justify-between">
      <div>
        <h2 className="text-xl font-black uppercase border-b-4 border-black pb-2 mb-4">
          Contexto Arquivístico
        </h2>
        <p className="font-medium text-black leading-snug mb-4 text-sm">
          Os relatórios de estágio obrigatório compõem o currículo do aluno. Como o MEN apenas oferta a disciplina, o fundo documental pertence ao curso do estudante.
        </p>
        <div className="bg-white border-4 border-black p-3 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
          <p className="font-bold text-sm">Possíveis Códigos IFES:</p>
          <ul className="text-sm font-medium mt-2 space-y-1">
            <li><strong>125.31</strong> - Provas, Exames, Trabalhos. (Fase corrente, eliminação após 1 ano do registro das notas).</li>
            <li><strong>125.43</strong> - Assentamentos individuais dos alunos / Dossiê (Guarda de 100 anos).</li>
          </ul>
        </div>
      </div>

      {/* Registros Recentes (Local) */}
      <div className="mt-8">
        <h3 className="font-black border-b-4 border-black pb-1 mb-2">Adicionados Agora:</h3>
        <ul className="space-y-2">
          {historico.slice(0, 3).map((item, idx) => (
            <li key={idx} className="bg-white border-4 border-black p-2 text-xs font-bold truncate">
              {item.pacote} - {item.curso}
            </li>
          ))}
          {historico.length === 0 && (
            <p className="text-xs font-medium italic">Nenhum registro nesta sessão.</p>
          )}
        </ul>
      </div>
    </div>

  </div>
</div>
);}
